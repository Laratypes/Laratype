import { API_NODE, apiPaths, buildUrl, isApiNode, isApiRoot, isBodylessStatus, isContract, isEndpoint, joinPath, routeErrors } from "@laratype/contract";
import type { API_ROOT, AnyApiNode, AnyContract, Api, ApiPath, ApiShape, Method } from "@laratype/contract";
import type { Client, ClientOf, ClientOptions, ClientRequest, FetchLike, HeaderValues, Manifest, ManifestRoute, ProvidedHeaders } from "./types";

const fail = (message: string): never => {
  throw new TypeError(`[@laratype/client] ${message}`);
};

/** What a call passes on: the runtime view of `CallInput`. */
interface RequestInput {
  readonly params?: Readonly<Record<string, string | number>>;
  readonly query?: object;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

type Send = (method: Method, path: string, input?: RequestInput) => Promise<Response>;

/**
 * Whether a relative request URL resolves to an http(s) URL in this page, as `fetch` would resolve it: against the
 * document's base URL (a `<base href>`) when there is a document, else the page location. `false` outside a browser
 * (Deno without `--location` throws on `location`), and for a base that can't resolve a path to http(s): `about:`,
 * `blob:`, `data:`.
 */
const resolvesInPage = (url: string): boolean => {
  try {
    const page = globalThis as { document?: { baseURI?: string }; location?: { href?: string } };
    const base = page.document?.baseURI || page.location?.href;
    return !!base && /^https?:$/.test(new URL(url, base).protocol);
  } catch {
    return false;
  }
};

/**
 * The error codes a route declares, each with every status it is declared with (two errors may share a code with
 * different statuses), or `undefined` when only the code is known, as in the manifest.
 */
type Declared = ReadonlyMap<string, ReadonlySet<number> | undefined>;

/** Computes a value on first use and keeps it: a route's declared errors are built on its first non-2xx answer. */
const once = <T>(make: () => T): (() => T) => {
  let made = false;
  let value: T;
  return () => {
    if (!made) {
      value = make();
      made = true;
    }
    return value;
  };
};

/** Groups declared errors by code, keeping every status. */
const declaredOf = (errors: ReadonlyArray<{ readonly code: string; readonly status: number }>): Declared => {
  const map = new Map<string, Set<number>>();
  for (const { code, status } of errors) map.set(code, (map.get(code) ?? new Set()).add(status));
  return map;
};

/**
 * What a 2xx must look like: the declared status (unknown for the manifest) and the data, `"json"` for a response
 * schema, `"none"` without one or for a body-less status (204, 205), `"any"` when unknown (the manifest: the body is parsed if there is one).
 */
interface Success {
  readonly status: number | undefined;
  readonly data: "json" | "none" | "any";
}

/**
 * One call of the client: its route name relative to the client root (`"users.posts.update"`), method, full path,
 * the 2xx it expects and its declared errors (computed on the first non-2xx answer).
 */
interface RouteSpec {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly success: Success;
  readonly declared: () => Declared;
}

/** The runtime view of `ClientResult`. */
type Result =
  | { ok: true; status: number; data: unknown; response: Response }
  | { ok: false; status: number; code: string; error: unknown; response: Response }
  | { ok: false; unexpected: true; status: number; error: unknown; response: Response | undefined; text?: string };

type Call = (input?: RequestInput) => Promise<Result>;

/** A rejected `fetch` (network failure, abort), told apart from the programming errors `send` also rejects with. */
class FetchFailed {
  constructor(readonly cause: unknown) {}
}

/** One node of an API tree (`appApi.users`), as `createClient` takes it. */
export type ApiNodeShape = AnyApiNode;

/** The `defineApi` root, told by its brand: a hand-made object (`{ posts: appApi.users.posts }`) is not one. */
export type ApiRootShape = { readonly [API_ROOT]: true };

const isManifestRoute = (value: unknown): value is ManifestRoute =>
  typeof value === "object" && value !== null && typeof (value as ManifestRoute).method === "string" && typeof (value as ManifestRoute).path === "string";

/** The generated manifest: a flat map of routes keyed by route name. */
const isManifest = (value: unknown): value is Manifest =>
  typeof value === "object" && value !== null && Object.values(value).every(isManifestRoute);

/** The origin a path-only `baseUrl` is parsed against; a path must keep it (`//host` would not). */
const SENTINEL = "http://__laratype_base__";

/**
 * A relative path keeps any origin it is parsed against; one URL parsing reads as another host (or can't parse) does not.
 * Two bases, so a `"//__laratype_base__/x"` that names the sentinel itself fails too, with two schemes, so does a
 * scheme-relative `"http:/evil.com"`.
 */
const keepsOrigin = (path: string): boolean => {
  try {
    return [SENTINEL, "https://__laratype_other__"].every((base) => new URL(path, base).origin === base);
  } catch {
    return false;
  }
};

/**
 * `"https://host/api"` → `["https://host", "/api"]`; a path (`"/api"`) or `""` has no origin. Anything else, such as
 * `"localhost:3000/api"`, is refused, and so is a query or a hash.
 */
const splitBaseUrl = (baseUrl: string): [origin: string, path: string] => {
  if (baseUrl === "") return ["", ""];
  // URL parsing silently drops tab, LF and CR ("/\t/evil.com" → "//evil.com") and turns a backslash into "/" ("/\evil.com"):
  // those are checked on the raw string, since the parsed URL no longer shows them
  if (/[\u0000-\u0020\u007f]/.test(baseUrl)) {
    fail(`createClient: baseUrl ${JSON.stringify(baseUrl)} must not contain whitespace or control characters`);
  }
  if (baseUrl.includes("\\")) fail(`createClient: baseUrl "${baseUrl}" must not contain a backslash`);
  // decided on the raw string: a path starts with "/", an absolute URL is written with "://". So "localhost:3000/api"
  // is neither, and "http://__laratype_base__/api" is absolute, not mistaken for a path by its origin
  const absolute = !baseUrl.startsWith("/");
  if (absolute && !/^[a-z][a-z\d+.-]*:\/\//i.test(baseUrl)) {
    fail(`createClient: baseUrl "${baseUrl}" must be an absolute URL (https://…) or a path starting with /`);
  }
  let url: URL;
  try {
    url = absolute ? new URL(baseUrl) : new URL(baseUrl, SENTINEL);
  } catch {
    return fail(`createClient: baseUrl "${baseUrl}" is not a valid URL`);
  }
  // a path must keep the origin: "//host/api" is protocol-relative, another host
  if (!absolute && !keepsOrigin(baseUrl)) {
    fail(`createClient: baseUrl "${baseUrl}" must be an absolute URL (https://…) or a path starting with /`);
  }
  if (/[?#]/.test(baseUrl)) fail(`createClient: baseUrl "${baseUrl}" must not have a query or a hash`);
  if (absolute) {
    if (url.protocol !== "http:" && url.protocol !== "https:") fail(`createClient: baseUrl "${baseUrl}" must use http or https`);
    if (url.username || url.password) fail(`createClient: baseUrl "${baseUrl}" must not contain credentials`);
  }
  return [absolute ? url.origin : "", url.pathname.replace(/\/+$/, "")];
};

/** A body on a GET or HEAD: fetch would refuse it, and that must not look like a network failure. */
const assertNoGetBody = (method: string, hasBody: boolean, path: string): void => {
  const upper = method.toUpperCase();
  if (hasBody && (upper === "GET" || upper === "HEAD")) fail(`a ${upper} request cannot have a body: "${path}"`);
};

/**
 * A call aborted before `fetch` (while the headers function or `onRequest` ran): the status-0 result fetch would give,
 * without running the next step.
 */
const throwIfAborted = (signal: AbortSignal | null | undefined): void => {
  if (signal?.aborted) throw new FetchFailed(signal.reason);
};

/** Whether the body was read or locked (a reader taken), so the client can't read it. */
const bodyTaken = (response: Response): boolean => response.bodyUsed || !!response.body?.locked;

/**
 * One request: the route path filled by `buildUrl`, the headers and the JSON body, sent with the injected fetch.
 * `buildUrl` only sees the route path; the result is then joined to `baseUrl`'s path with the server's `joinPath`, so
 * `baseUrl` is never parsed as route syntax, and a single contract's `"/"` route under `https://host/api/users` is
 * `/api/users`, not `/api/users/` (a 404 under strict routing).
 * Headers: `options.headers` (a function is called, and awaited, at each call), overridden by the call's own `headers`;
 * then `content-type: application/json` for a body when neither sets one. `options.credentials` is set when given, and so is
 * `init.redirect`, from `options.redirect`, default `"error"`; `onRequest` can still override it.
 * `onRequest` gets the request just before `fetch`, and `onResponse` the response before its body is read; a throw from
 * either rejects the call (the unread body is then cancelled), and so does an `onResponse` that reads the body. A call
 * aborted before `fetch` is a `FetchFailed`, as fetch would reject, and runs neither the headers function nor `onRequest`
 * once aborted.
 * Async, so every failure (a missing param, a body JSON cannot hold, no fetch) rejects instead of throwing.
 * A GET with a body rejects the call, and so does a relative URL for the global `fetch` outside a browser; `fetch` gets
 * `(url, init)` and resolves a relative URL itself. A synchronous throw from `fetch` rejects the call too; only a
 * rejected promise is a `FetchFailed`, which the result union turns into `unexpected`.
 * The options are read from `options` when each call starts, so changing one (a refreshed token) applies to the next
 * call, and one call never mixes old and new options.
 */
const createSend = (options: ClientOptions): Send => async (method, path, input = {}) => {
  const { baseUrl, fetch: injected, headers: defaults, credentials, redirect, onRequest, onResponse } = options;
  const [origin, basePath] = splitBaseUrl(baseUrl ?? "");
  const built = buildUrl(path, { params: input.params, query: input.query });
  const q = built.indexOf("?");
  const pathname = joinPath(basePath, q < 0 ? built : built.slice(0, q));
  // without an origin, "//evil.com" (or "/\evil.com", "/\t/evil.com", as URL parsing reads them) is another host: a route
  // path a manifest or a forged endpoint holds can't be trusted, so it is parsed like a path baseUrl
  if (!origin && !keepsOrigin(pathname)) fail(`route path "${path}" would leave the page's origin: "${pathname}"`);
  const url = origin + pathname + (q < 0 ? "" : built.slice(q));
  assertNoGetBody(method, input.body !== undefined, path);
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  let fetchFn: FetchLike;
  if (injected) {
    // an injected fetch may resolve relative URLs itself (an SSR wrapper, a test fake), so it isn't guarded
    fetchFn = injected;
  } else {
    const globalFetch = globalThis.fetch;
    if (typeof globalFetch !== "function") fail("no fetch available: pass options.fetch");
    // a relative URL ("" or "/api" baseUrl) needs a page to resolve against; fetch resolves it itself
    if (!origin && !resolvesInPage(url)) {
      fail(`relative URL "${url}" with the global fetch outside a browser: set options.baseUrl to an absolute URL, or pass options.fetch`);
    }
    fetchFn = globalFetch;
  }
  // after the checks above, so a request that is never sent costs no headers call (a token refresh, say)
  const { signal } = input;
  throwIfAborted(signal);
  let headers: Headers;
  if (typeof defaults === "function") {
    headers = new Headers(await defaults());
    throwIfAborted(signal);
  } else {
    headers = new Headers(defaults);
  }
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (value !== undefined) headers.set(key, value);
  }
  const init: ClientRequest["init"] = { method: method.toUpperCase(), headers, redirect: redirect ?? "error" };
  if (credentials !== undefined) init.credentials = credentials;
  if (body !== undefined) {
    init.body = body;
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  if (signal) init.signal = signal;
  const request: ClientRequest = Object.freeze({ url, init });
  if (onRequest) {
    await onRequest(request);
    // onRequest may have set a body or changed the method (fetch's default is GET)
    assertNoGetBody(init.method ?? "GET", init.body != null, path);
    throwIfAborted(init.signal);
  }
  // a synchronous throw from fetch rejects the call as a programming error; only a rejected promise is a network failure
  const pending = fetchFn(url, init);
  let response: Response;
  try {
    response = await pending;
  } catch (error) {
    throw new FetchFailed(error);
  }
  if (onResponse) {
    // an injected fetch may hand over a used body; only a body this hook used is its fault
    const readable = !bodyTaken(response);
    try {
      await onResponse(response, request);
    } catch (error) {
      // the call rejects and nobody reads the body: release it
      cancelBody(response);
      throw error;
    }
    if (readable && bodyTaken(response)) fail("onResponse read the response body: read a response.clone() instead");
  }
  return response;
};

const unexpected = (status: number, error: unknown, response: Response | undefined, text?: string): Result =>
  text === undefined ? { ok: false, unexpected: true, status, error, response } : { ok: false, unexpected: true, status, error, response, text };

/** Releases a body the client won't read (it can hold a connection open in undici); errors are ignored. */
const cancelBody = (response: Response): void => {
  try {
    response.body?.cancel().catch(() => {});
  } catch {
    // a body that is locked or already gone needs no release
  }
};

/**
 * Reads the response into the result union. The body is read once, from `response` itself, so a result's `response`
 * has its body consumed (status and headers stay usable). A success with no data doesn't read it: a 204 or 205 has none, and
 * any other body-less success has its body cancelled, so it doesn't hold a connection open.
 * - 2xx: the declared status (when known) or `unexpected`. Data: none without a response schema or for a body-less
 *   status; with a schema, the parsed JSON body, and an empty body is `unexpected` (the server broke the contract).
 * - Otherwise the wire format is `{ code, ...body }`: a declared code (with its status, when known) is a declared
 *   error whose `error` is the body without `code`; anything else is unexpected.
 * - A body that isn't JSON, or fails while it is read (an abort or a network error after the headers arrived), is
 *   `unexpected` with the HTTP status, the `response` and that error.
 */
async function toResult(response: Response, success: Success, declared: () => Declared): Promise<Result> {
  const { status } = response;
  const expected = success.status === undefined || status === success.status;
  if (response.ok && expected && success.data === "none") {
    if (!isBodylessStatus(status)) cancelBody(response);
    return { ok: true, status, data: undefined, response };
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return unexpected(status, error, response);
  }
  let body: unknown;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch (error) {
    // the body is consumed: keep its text (an HTML 502 from a proxy, say)
    return unexpected(status, error, response, text);
  }
  if (response.ok) {
    if (!expected) return unexpected(status, body, response);
    if (success.data === "json" && text === "") {
      return unexpected(status, new TypeError(`[@laratype/client] empty ${status} body: the endpoint declares a response`), response);
    }
    return { ok: true, status, data: body, response };
  }
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const { code, ...error } = body as Record<string, unknown>;
    const errors = declared();
    if (typeof code === "string" && errors.has(code)) {
      const statuses = errors.get(code);
      if (statuses === undefined || statuses.has(status)) return { ok: false, status, code, error, response };
    }
  }
  return unexpected(status, body, response);
}

/**
 * One endpoint call: `send` wrapped into the result union. A network failure or an abort before the headers arrive
 * resolves as unexpected (`status: 0`, no `response`); a programming error, such as a missing required param, rejects.
 * The declared errors are computed on the first non-2xx answer, then kept.
 */
const createCall = (send: Send, method: Method, route: RouteSpec): Call => {
  return async (input) => {
    let response: Response;
    try {
      response = await send(method, route.path, input);
    } catch (error) {
      if (error instanceof FetchFailed) return unexpected(0, error.cause, undefined);
      throw error;
    }
    return toResult(response, route.success, route.declared);
  };
};

const freezeTree = (node: Record<string, unknown>): object => {
  for (const value of Object.values(node)) if (typeof value === "object") freezeTree(value as Record<string, unknown>);
  return Object.freeze(node);
};

/**
 * Nests flat route names into the client: `"users.posts.update"` → `client.users.posts.update`.
 * The one builder for every input: the routes come from `apiPaths()` or from the generated manifest.
 */
function buildTree(routes: readonly RouteSpec[], send: Send, isManifest: boolean): object {
  const where = isManifest ? " in the manifest" : "";
  const root: Record<string, unknown> = Object.create(null);
  for (const route of routes) {
    const { name } = route;
    const segments = name.split(".");
    // manifest names are full route names (folder + endpoint key); apiPaths names are valid by construction
    if (segments.some((s) => s === "") || (isManifest && segments.length < 2)) fail(`createClient: invalid route name "${name}"${where}`);
    const key = segments.pop()!;
    let node = root;
    for (const segment of segments) {
      if (typeof node[segment] === "function") fail(`createClient: "${name}" is under the endpoint "${segment}"${where}`);
      node = (node[segment] ??= Object.create(null)) as Record<string, unknown>;
    }
    if (node[key] !== undefined) fail(`createClient: "${name}" is both an endpoint and a node${where}`);
    node[key] = createCall(send, route.method.toLowerCase() as Method, route);
  }
  return freezeTree(root);
}

/**
 * The routes of the appApi root, an API node or a contract from `apiPaths()`: names, methods and full paths. Each
 * declares its errors with `routeErrors` (derived from every level, plus `throws`), which never throws: a contract
 * alone lacks its folder scopes, so the consistency check of `resolveCapabilities` doesn't apply.
 * An API node's names are relative to it: `appApi.users` → `"index"`, `"posts.update"`.
 */
const pathsOf = (api: object): RouteSpec[] => {
  const prefix = isApiNode(api) ? `${api[API_NODE].name}.` : "";
  return (apiPaths(api as unknown as Api) as ApiPath[]).map((r) => {
    const { response, status } = r.endpoint.def;
    return {
      name: r.name.slice(prefix.length),
      method: r.method,
      path: r.path,
      success: { status, data: response && !isBodylessStatus(status) ? "json" : "none" },
      declared: once(() => declaredOf(routeErrors(r))),
    };
  });
};

/** The manifest's routes; it knows the error codes only (not their status), and neither the success status nor the response schema. */
const manifestRoutes = (manifest: Manifest): RouteSpec[] =>
  Object.entries(manifest).map(([name, route]) => {
    const { errors } = route;
    // checked here, at createClient: a malformed list would otherwise make a call reject on its first error answer
    if (errors !== undefined && !(Array.isArray(errors) && errors.every((code) => typeof code === "string"))) {
      fail(`createClient: "${name}" errors in the manifest must be an array of error codes (strings)`);
    }
    return {
      name,
      method: route.method,
      path: route.path,
      success: { status: undefined, data: "any" },
      declared: once(() => new Map((errors ?? []).map((code) => [code, undefined]))),
    };
  });

/**
 * The typed client for a separate-repo FE (S2 option c), from the generated api.ts (`sauf types:generate`):
 * `createClient<AppApi>(manifest)`. The `AppApi` type argument types the calls (without it the client is `never`).
 * The manifest holds each route's method and full path, so the FE loads no contract file of the app and no schema library.
 */
export function createClient<T extends ApiShape<T> = never>(manifest: Manifest, options?: ClientOptions): Client<T>;
/**
 * The manifest client with the type of `options.headers` as the second type argument, since it is not inferred next
 * to an explicit `AppApi`: `createClient<AppApi, { 'x-api-key': string }>(manifest, { headers: { 'x-api-key': key } })`.
 * `options.headers` is then required, so the headers it names are sent.
 */
export function createClient<T extends ApiShape<T>, Hd extends HeadersInit>(
  manifest: Manifest,
  options: ClientOptions<Hd> & { headers: Hd & HeaderValues },
): Client<T, ProvidedHeaders<Hd>>;
/**
 * The typed client for one contract file. It has no folder prefix: `baseUrl`'s path is joined to its endpoint paths
 * like the server's `joinPath`, and its params are only its own.
 */
export function createClient<C extends AnyContract, const Hd extends HeadersInit = HeadersInit>(
  contract: C,
  options?: ClientOptions<Hd>,
): ClientOf<C, ProvidedHeaders<Hd>>;
/** The typed client for one API node (`appApi.users`), named relative to it: `api.posts.update`. */
export function createClient<N extends ApiNodeShape, const Hd extends HeadersInit = HeadersInit>(
  node: N,
  options?: ClientOptions<Hd>,
): ClientOf<N, ProvidedHeaders<Hd>>;
/**
 * The typed client for the generated `appApi` (`$api`). Names follow the folder tree (`api.users.posts.update(...)`)
 * and URLs are the contracts' full paths, so `baseUrl` is only the origin.
 *
 * @example
 * const api = createClient(appApi, { baseUrl: 'https://example.com' })
 * const result = await api.users.posts.update({ params: { user: 1, post: 2 }, body: { title: 'Hi' } })
 */
export function createClient<A extends ApiRootShape, const Hd extends HeadersInit = HeadersInit>(
  api: A,
  options?: ClientOptions<Hd>,
): ClientOf<A, ProvidedHeaders<Hd>>;
export function createClient(api: object, options: ClientOptions = {}): object {
  splitBaseUrl(options.baseUrl ?? "");
  const send = createSend(options);
  // before isManifest: an endpoint's own fields ({ def }) would pass for a one-route manifest
  if (isEndpoint(api)) return fail("createClient: got a single endpoint; pass its contract, an API node or the appApi");
  if (isContract(api) || isApiNode(api) || isApiRoot(api)) return buildTree(pathsOf(api), send, false);
  if (isManifest(api)) return buildTree(manifestRoutes(api), send, true);
  return fail("createClient: expected the appApi from defineApi, an API node, a contract or the generated manifest");
}
