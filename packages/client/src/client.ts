import { API_NODE, apiPaths, buildUrl, isContract, isEndpoint, joinPath, routeErrors } from "@laratype/contract";
import type { AnyContract, Api, ApiNodeInfo, ApiPath, ApiShape, Method } from "@laratype/contract";
import type { Client, ClientOf, ClientOptions, Manifest, ManifestRoute } from "./types";

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
 * The URL a relative request URL resolves against, as `fetch` does: the document's base URL (a `<base href>`, a
 * srcdoc iframe's) when there is a document, else the page location; `undefined` outside a browser, including Deno
 * without `--location`, where reading `location` throws.
 */
const pageBaseUrl = (): string | undefined => {
  try {
    const page = globalThis as { document?: { baseURI?: string }; location?: { href?: string } };
    return page.document?.baseURI || page.location?.href;
  } catch {
    return undefined;
  }
};

/**
 * The error codes a route declares, each with every status it is declared with (two errors may share a code with
 * different statuses), or `undefined` when only the code is known, as in the manifest.
 */
type Declared = ReadonlyMap<string, ReadonlySet<number> | undefined>;

/** Groups declared errors by code, keeping every status. */
const declaredOf = (errors: ReadonlyArray<{ readonly code: string; readonly status: number }>): Declared => {
  const map = new Map<string, Set<number>>();
  for (const { code, status } of errors) map.set(code, (map.get(code) ?? new Set()).add(status));
  return map;
};

/**
 * What a 2xx must look like: the declared status (unknown for the manifest) and the data, `"json"` for a response
 * schema, `"none"` without one or for a 204, `"any"` when unknown (the manifest: the body is parsed if there is one).
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

type TreeNode = Readonly<Record<string | symbol, unknown>>;

/** One node of an API tree (`appApi.users`), as `createClient` takes it. */
export type ApiNodeShape = { readonly [API_NODE]: ApiNodeInfo };

/** The `defineApi` root: each key is an API node whose own name is that key (`appApi.users` is named `"users"`). */
export type ApiRootShape<A> = { readonly [K in keyof A]: K extends string ? { readonly [API_NODE]: ApiNodeInfo<K> } : never };

const isApiNode = (value: unknown): value is TreeNode =>
  typeof value === "object" && value !== null && typeof (value as TreeNode)[API_NODE] === "object";

/**
 * The `defineApi` root, which carries no brand of its own: every value is an API node whose name is its key.
 * So a hand-made object (`{ posts: appApi.users.posts }`) is not a root.
 */
const isApiRoot = (value: unknown): value is TreeNode =>
  typeof value === "object" &&
  value !== null &&
  Object.entries(value).every(([key, node]) => isApiNode(node) && (node[API_NODE] as ApiNodeInfo).name === key);

const isManifestRoute = (value: unknown): value is ManifestRoute =>
  typeof value === "object" && value !== null && typeof (value as ManifestRoute).method === "string" && typeof (value as ManifestRoute).path === "string";

/** The generated manifest: a flat map of routes keyed by route name. */
const isManifest = (value: unknown): value is Manifest =>
  typeof value === "object" && value !== null && Object.values(value).every(isManifestRoute);

/**
 * `"https://host/api"` → `["https://host", "/api"]`; a path (`"/api"`) or `""` has no origin. Anything else, such as
 * `"localhost:3000/api"`, is refused, and so is a query or a hash.
 */
const splitBaseUrl = (baseUrl: string): [origin: string, path: string] => {
  const origin = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i.exec(baseUrl)?.[0] ?? "";
  const path = baseUrl.slice(origin.length);
  // without an origin it must be a path: "/api", not "api", "localhost:3000/api" or a protocol-relative "//host/api"
  if (!origin && path !== "" && (!path.startsWith("/") || path.startsWith("//"))) {
    fail(`createClient: baseUrl "${baseUrl}" must be an absolute URL (https://…) or a path starting with /`);
  }
  if (/[?#]/.test(path)) fail(`createClient: baseUrl "${baseUrl}" must not have a query or a hash`);
  // URL parsing turns a backslash into "/" for http(s), so "/\evil.com" would be another host
  if (baseUrl.includes("\\")) fail(`createClient: baseUrl "${baseUrl}" must not contain a backslash`);
  return [origin, path.replace(/\/+$/, "")];
};

/**
 * One request: the route path filled by `buildUrl`, the headers and the JSON body, sent with the injected fetch.
 * `buildUrl` only sees the route path; the result is then joined to `baseUrl`'s path with the server's `joinPath`, so
 * `baseUrl` is never parsed as route syntax, and a single contract's `"/"` route under `https://host/api/users` is
 * `/api/users`, not `/api/users/` (a 404 under strict routing).
 * Headers: the call's own, then `options.headers`, then `content-type: application/json` for a body.
 * Async, so every failure (a missing param, a body JSON cannot hold, no fetch) rejects instead of throwing.
 * With the global `fetch`, the request is checked with a `Request` before `fetch` and outside `FetchFailed`, so a
 * configuration or programming error (a GET or HEAD with a body, a bad `RequestInit`, a relative URL outside a browser)
 * rejects the call; `fetch` then gets `(resolvedUrl, init)`. An injected `fetch` gets `(url, init)` unchecked. A
 * synchronous throw from `fetch` rejects the call too; only a rejected promise is a `FetchFailed`, which the result
 * union turns into `unexpected`.
 * `baseUrl`, `headers` and `fetch` are read from `options` at each call, so changing them (a refreshed token) applies.
 */
const createSend = (options: ClientOptions): Send => async (method, path, input = {}) => {
  const [origin, basePath] = splitBaseUrl(options.baseUrl ?? "");
  const built = buildUrl(path, { params: input.params, query: input.query });
  const q = built.indexOf("?");
  const url = origin + (q < 0 ? joinPath(basePath, built) : joinPath(basePath, built.slice(0, q)) + built.slice(q));
  const headers = new Headers(options.headers);
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (value !== undefined) headers.set(key, value);
  }
  const init: RequestInit = { method: method.toUpperCase(), headers };
  if (input.body !== undefined) {
    init.body = JSON.stringify(input.body);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  if (input.signal) init.signal = input.signal;
  let pending: () => Promise<Response>;
  const injected = options.fetch;
  if (injected) {
    // an injected fetch gets (url, init) as built: it may resolve relative URLs itself (an SSR wrapper, a test fake)
    // or accept what a strict Request refuses (credentials in the URL), so the client doesn't validate for it
    pending = () => injected(url, init);
  } else {
    const fetchFn = globalThis.fetch;
    if (typeof fetchFn !== "function") fail("no fetch available: pass options.fetch");
    // a relative URL ("" or "/api" baseUrl) needs a page to resolve against
    const base = origin ? undefined : pageBaseUrl();
    if (!origin && !base) {
      fail(`relative URL "${url}" with the global fetch outside a browser: set options.baseUrl to an absolute URL, or pass options.fetch`);
    }
    let resolved = url;
    if (typeof URL === "function") {
      resolved = new URL(url, base).href;
      // validation only, outside FetchFailed, so a GET or HEAD with a body or a bad RequestInit rejects the call. No
      // signal (it would add an abort listener). fetch still gets (url, init), not this Request: a polyfilled global
      // fetch (node-fetch, cross-fetch) does not understand another implementation's Request.
      if (typeof Request === "function") new Request(resolved, { ...init, signal: undefined });
    }
    pending = () => fetchFn(resolved, init);
  }
  // a synchronous throw from fetch rejects the call as a programming error; only a rejected promise is a network failure
  const response = pending();
  try {
    return await response;
  } catch (error) {
    throw new FetchFailed(error);
  }
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
 * has its body consumed (status and headers stay usable). A success with no data doesn't read it: a 204 has none, and
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
    if (status !== 204) cancelBody(response);
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
  let declared: Declared | undefined;
  const lazy = () => (declared ??= route.declared());
  return async (input) => {
    let response: Response;
    try {
      response = await send(method, route.path, input);
    } catch (error) {
      if (error instanceof FetchFailed) return unexpected(0, error.cause, undefined);
      throw error;
    }
    return toResult(response, route.success, lazy);
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
  const prefix = isApiNode(api) ? `${(api[API_NODE] as ApiNodeInfo).name}.` : "";
  return (apiPaths(api as unknown as Api) as ApiPath[]).map((r) => {
    const { response, status } = r.endpoint.def;
    return {
      name: r.name.slice(prefix.length),
      method: r.method,
      path: r.path,
      success: { status, data: response && status !== 204 ? "json" : "none" },
      declared: () => declaredOf(routeErrors(r)),
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
      declared: () => new Map((errors ?? []).map((code) => [code, undefined])),
    };
  });

/**
 * The typed client for a separate-repo FE (S2 option c), from the generated api.ts (`sauf types:generate`):
 * `createClient<AppApi>(manifest)`. The `AppApi` type argument types the calls (without it the client is `never`).
 * The manifest holds each route's method and full path, so the FE loads no contract file of the app and no schema library.
 */
export function createClient<T extends ApiShape<T> = never>(manifest: Manifest, options?: ClientOptions): Client<T>;
/**
 * The typed client for one contract file. It has no folder prefix: `baseUrl`'s path is joined to its endpoint paths
 * like the server's `joinPath`, and its params are only its own.
 */
export function createClient<C extends AnyContract>(contract: C, options?: ClientOptions): ClientOf<C>;
/** The typed client for one API node (`appApi.users`), named relative to it: `api.posts.update`. */
export function createClient<N extends ApiNodeShape>(node: N, options?: ClientOptions): ClientOf<N>;
/**
 * The typed client for the generated `appApi` (`$api`). Names follow the folder tree (`api.users.posts.update(...)`)
 * and URLs are the contracts' full paths, so `baseUrl` is only the origin.
 *
 * @example
 * const api = createClient(appApi, { baseUrl: 'https://example.com' })
 * const result = await api.users.posts.update({ params: { user: 1, post: 2 }, body: { title: 'Hi' } })
 */
export function createClient<A extends ApiRootShape<A>>(api: A, options?: ClientOptions): ClientOf<A>;
export function createClient(api: object, options: ClientOptions = {}): object {
  splitBaseUrl(options.baseUrl ?? "");
  const send = createSend(options);
  // before isManifest: an endpoint's own fields ({ def }) would pass for a one-route manifest
  if (isEndpoint(api)) return fail("createClient: got a single endpoint; pass its contract, an API node or the appApi");
  if (isContract(api) || isApiNode(api) || isApiRoot(api)) return buildTree(pathsOf(api), send, false);
  if (isManifest(api)) return buildTree(manifestRoutes(api), send, true);
  return fail("createClient: expected the appApi from defineApi, an API node, a contract or the generated manifest");
}
