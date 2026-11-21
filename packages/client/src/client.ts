import { API_NODE, apiPaths, buildUrl, isApiNode, isApiRoot, isBodylessStatus, isContract, isEndpoint, isEndpointPath, isFailureStatus, joinPath, routeErrors } from "@laratype/contract";
import type { API_ROOT, AnyApiNode, AnyContract, Api, ApiPath, ApiShape, Method, StandardSchemaV1 } from "@laratype/contract";
import type { Client, ClientOf, ClientOptions, ClientRequest, FetchLike, HeaderValues, Manifest, ManifestClientOptions, PathClient, PathClientOptions, ProvidedHeaders } from "./types";
import { checkResponseBody } from "./validate";
import type { ResponseCheckFailure } from "./validate";

// A function declaration, not a const arrow: TypeScript only treats the call as a check that ends the branch (so the
// code after `if (!isPlainObject(value)) fail(...)` sees the narrowed type) for a function declaration.
function fail(message: string): never {
  throw new TypeError(`[@laratype/client] ${message}`);
}

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

/** Computes a value on first use and keeps it: a route's declared errors are built on its first 4xx or 5xx answer. */
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

/** One declared error code, with its status, or without one when only the code is known (an older manifest's string). */
interface DeclaredCode {
  readonly code: string;
  readonly status?: number;
}

/**
 * Groups declared errors by code, keeping every status. An entry without a status (an older manifest's code string)
 * makes its code match any 4xx or 5xx, whatever other entries say.
 */
const declaredOf = (errors: readonly DeclaredCode[]): Declared => {
  const map: Map<string, Set<number> | undefined> = new Map();
  for (const { code, status } of errors) {
    if (status === undefined) {
      map.set(code, undefined);
      continue;
    }
    if (!map.has(code)) map.set(code, new Set([status]));
    else map.get(code)?.add(status);
  }
  return map;
};

/**
 * What a 2xx must look like: the declared status (unknown for the path client and an older manifest) and the data,
 * `"json"` for a response schema, `"none"` without one or for a body-less status (204, 205), `"any"` when unknown (the
 * body is parsed if there is one).
 */
interface Success {
  readonly status: number | undefined;
  readonly data: "json" | "none" | "any";
  /** The dev-mode response check (CL6 #159), set per call when `validateResponses` is on. */
  readonly check?: (body: unknown) => Promise<ResponseCheckFailure | undefined>;
}

/** The success of a client with no declared status (the path client, a manifest generated before CL8): any 2xx, body parsed if any. */
const UNKNOWN_SUCCESS: Success = { status: undefined, data: "any" };

/**
 * One call of the client: its route name relative to the client root (`"users.posts.update"`; the full path for a
 * path-style call, which has no route name), method, full path, the 2xx it expects, the schema its success body must
 * match (none in the manifest or the path client) and its declared errors (computed on the first 4xx or 5xx answer;
 * absent for a path-style call, which has no contract runtime).
 */
interface RouteSpec {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly success: Success;
  readonly schema?: StandardSchemaV1;
  readonly declared?: () => Declared;
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

/** A value cut to 120 characters: a diagnostic may echo a getter's 1 MB answer, but not whole. */
const truncate = (text: string): string => (text.length > 120 ? `${text.slice(0, 117)}...` : text);

/** A diagnostic value: a string is quoted and escaped, anything else is named by its type, never more than 120 characters. */
const preview = (value: unknown): string => {
  let text: string;
  switch (typeof value) {
    case "string":
      // JSON.stringify escapes control characters and lone surrogates, so the message is always printable
      text = JSON.stringify(value);
      break;
    case "number":
      // String keeps NaN and Infinity visible; JSON.stringify would print null
      text = String(value);
      break;
    case "bigint":
      text = `${value}n`;
      break;
    case "boolean":
    case "undefined":
      text = String(value);
      break;
    case "symbol":
      text = "a symbol";
      break;
    case "function":
      text = "a function";
      break;
    default:
      // never read an object's fields, toJSON or Symbol.toStringTag here: the value is already refused
      text = value === null ? "null" : Array.isArray(value) ? "an array" : "an object";
  }
  return truncate(text);
};

/** A plain object: the manifest and each route must be one. Arrays, Maps, class instances and a set prototype are not. */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
};

/** What a non-object value (or non-plain object) is, for the diagnostic: "null", "a number", "a Map", "an instance of Route". */
const kindOf = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value !== "object") return `a ${typeof value}`;
  if (Array.isArray(value)) return "an array";
  try {
    const tag = Object.prototype.toString.call(value).slice(8, -1);
    if (tag !== "Object") return truncate(`a ${tag}`);
    const name = (value as { constructor?: { name?: unknown } }).constructor?.name;
    return typeof name === "string" && name !== "Object" ? truncate(`an instance of ${name}`) : "a non-plain object";
  } catch {
    return "a non-plain object";
  }
};

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
 * then `content-type: application/json` for a body when neither sets one. `options.credentials` is set when given, and
 * `init.redirect` is set on every call, from `options.redirect`, default `"manual"`; `onRequest` can still override it.
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
  const {
    baseUrl,
    fetch: injected,
    headers: defaults,
    credentials,
    redirect = "manual",
    onRequest,
    onResponse,
  } = options;
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
  const init: ClientRequest["init"] = { method: method.toUpperCase(), headers, redirect };
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
 * - Otherwise the wire format is `{ code, ...body }`: on a 4xx or 5xx, a declared code (with its status, when known)
 *   is a declared error whose `error` is the body without `code`; anything else is unexpected. A 3xx is always
 *   unexpected, whatever code its body carries: a contract can't declare one, and a manifest declares 2xx successes and
 *   4xx/5xx errors, so its body would match no declared route.
 * - `declared` is absent for a path-style call: it has no contract runtime, so it trusts the path, and any string
 *   `code` on a 4xx or 5xx is a declared error (the type says the endpoint declares it; http.md › Undeclared-error
 *   check keeps the server honest).
 * - A body that isn't JSON, or fails while it is read (an abort or a network error after the headers arrived), is
 *   `unexpected` with the HTTP status, the `response` and that error.
 */
async function toResult(response: Response, success: Success, declared?: () => Declared): Promise<Result> {
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
    // CL6 #159: dev-mode response validation, awaited before the call settles; the data stays the parsed JSON
    if (success.check) {
      const failed = await success.check(body);
      if (failed) return unexpected(status, failed.error, response);
    }
    return { ok: true, status, data: body, response };
  }
  // a 3xx is never a declared error (see the doc above): only 4xx and 5xx body codes are matched
  if (status >= 400 && status < 600 && typeof body === "object" && body !== null && !Array.isArray(body)) {
    const { code, ...error } = body as Record<string, unknown>;
    if (typeof code === "string") {
      // no contract runtime (the path client): the path names the endpoint, so the code is taken as declared
      if (!declared) return { ok: false, status, code, error, response };
      const errors = declared();
      if (errors.has(code)) {
        const statuses = errors.get(code);
        if (statuses === undefined || statuses.has(status)) return { ok: false, status, code, error, response };
      }
    }
  }
  return unexpected(status, body, response);
}

/**
 * One endpoint call: `send` wrapped into the result union. A network failure or an abort before the headers arrive
 * resolves as unexpected (`status: 0`, no `response`); a programming error, such as a missing required param, rejects.
 * The declared errors are computed on the first 4xx or 5xx answer, then kept. Without `declared` (the path client),
 * the result trusts the path and takes any string `code` as declared.
 * `options.validateResponses` is read when the call starts: when it is on and the endpoint has a response schema, the
 * success body is checked against it (CL6 #159), and a mismatch is unexpected.
 */
const createCall = (send: Send, route: RouteSpec, options: ClientOptions): Call => {
  return async (input) => {
    const { schema } = route;
    const check = options.validateResponses && schema ? (body: unknown) => checkResponseBody(schema, body, route.name) : undefined;
    const success = check ? { ...route.success, check } : route.success;
    let response: Response;
    try {
      response = await send(route.method.toLowerCase() as Method, route.path, input);
    } catch (error) {
      if (error instanceof FetchFailed) return unexpected(0, error.cause, undefined);
      throw error;
    }
    return toResult(response, success, route.declared);
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
function buildTree(routes: readonly RouteSpec[], send: Send, isManifest: boolean, options: ClientOptions): object {
  const where = isManifest ? " in the manifest" : "";
  const root: Record<string, unknown> = Object.create(null);
  for (const route of routes) {
    const { name } = route;
    const segments = name.split(".");
    // manifest names are full route names (folder + endpoint key); apiPaths names are valid by construction
    if (segments.some((s) => s === "") || (isManifest && (segments.length < 2 || /[\u0000-\u001f\u007f]/.test(name)))) {
      fail(`createClient: invalid route name ${preview(name)}${where}`);
    }
    const key = segments.pop()!;
    let node = root;
    for (const segment of segments) {
      if (typeof node[segment] === "function") fail(`createClient: ${preview(name)} is under the endpoint ${preview(segment)}${where}`);
      node = (node[segment] ??= Object.create(null)) as Record<string, unknown>;
    }
    if (node[key] !== undefined) fail(`createClient: ${preview(name)} is both an endpoint and a node${where}`);
    node[key] = createCall(send, route, options);
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
    const json = response !== undefined && !isBodylessStatus(status);
    return {
      name: r.name.slice(prefix.length),
      method: r.method,
      path: r.path,
      success: { status, data: json ? "json" : "none" },
      schema: json ? response : undefined,
      declared: once(() => declaredOf(routeErrors(r))),
    };
  });
};

/** The methods of `PathClient` and of a manifest route, in declaration order. */
const METHODS: readonly Method[] = ["get", "post", "put", "patch", "delete"];

/** The fields a manifest route may carry; anything else on the object is ignored, for forward compatibility. */
const MANIFEST_FIELDS = ["name", "method", "path", "status", "response", "errors"] as const;

/** The most error entries one manifest route may list; a longer or sparse array is refused before any iteration. */
const MAX_MANIFEST_ERRORS = 1000;

/**
 * The manifest's routes, validated and snapshotted: every route field is read once from the caller's objects, and only
 * the snapshot reaches the client, so a Proxy or a getter that changes its answer on a second read cannot affect a call.
 * `undefined` when the object is not a manifest; a bad route throws, naming its key.
 */
const manifestRoutes = (manifest: Record<string, unknown>): RouteSpec[] | undefined => {
  const keys = Object.keys(manifest);
  const values: unknown[] = [];
  for (const key of keys) values.push(manifest[key]);
  // A manifest's keys are dotted route names, so a dotted key always makes the object a manifest and every value a route
  // (even a branded input, which is then refused naming its key). Without a dotted key, an object of branded values is one
  // of the other inputs (`{ posts: endpoint }`, `{ users: contract }`, `{ users: node }`), and a plain map whose values
  // are all objects is a manifest with a bad name (so `{ health: route }` says "invalid route name"); `{ nope: 1 }` is
  // neither and keeps the generic "expected ..." error.
  const dotted = keys.some((key) => key.includes("."));
  if (!dotted && (values.some((value) => isEndpoint(value) || isContract(value) || isApiNode(value)) || !values.every((value) => typeof value === "object" && value !== null))) {
    return undefined;
  }
  return keys.map((key, i) => manifestRoute(key, values[i]));
};

/** One manifest route: snapshot the fields once, validate them, and build the route spec the call uses. */
const manifestRoute = (key: string, value: unknown): RouteSpec => {
  const where = `createClient: ${preview(key)}`;
  // a branded input under a route key is a mistake, not a route: its own fields are not a manifest route
  const branded = isEndpoint(value) ? "an endpoint" : isContract(value) ? "a contract" : isApiNode(value) ? "an API node" : undefined;
  if (branded) fail(`${where}: a route must be a plain object, got ${branded}`);
  if (!isPlainObject(value)) fail(`${where}: a route must be a plain object, got ${kindOf(value)}`);
  // one read per own field, into a null-prototype snapshot: every check below and every call uses only the snapshot
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const field of MANIFEST_FIELDS) snapshot[field] = Object.hasOwn(value, field) ? value[field] : undefined;
  const { name, method, path, status, response, errors } = snapshot;
  // the key is authoritative; the emitter writes no `name`, so one that disagrees was hand-edited
  if (name !== undefined && name !== key) fail(`${where}: the route name ${preview(name)} does not match its manifest key`);
  if (typeof method !== "string" || !METHODS.includes(method as Method)) {
    fail(`${where}: the method must be one of ${METHODS.join(", ")}, got ${preview(method)}`);
  }
  // one rule, the contract's own: one leading "/" (not "//" or "/\"), no control characters
  if (!isEndpointPath(path)) fail(`${where}: the path must start with one "/" and must not contain control characters, got ${preview(path)}`);
  if (status !== undefined) {
    if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) {
      fail(`${where}: the status must be an integer from 100 to 599, got ${preview(status)}`);
    }
    if (status < 200 || status > 299) fail(`${where}: the status must be a 2xx success status (200-299), got ${preview(status)}`);
  }
  if (response !== undefined && typeof response !== "boolean") fail(`${where}: response must be a boolean, got ${preview(response)}`);
  if (response === true && status !== undefined && isBodylessStatus(status)) fail(`${where}: a 204 or 205 has no body; response must be false`);
  const declared: DeclaredCode[] = [];
  if (errors !== undefined) {
    // array-like objects (a `{ length: 1e9 }`) are refused by this check, without reading a single entry
    if (!Array.isArray(errors)) {
      fail(`${where}: errors must be an array of error codes (strings) or { status, code } entries, got ${preview(errors)}`);
    }
    // checked from length before iterating, so a sparse `new Array(1e9)` cannot hang; read once, so a Proxy array whose
    // length grows after the check is still walked only up to the checked count. A Proxy can answer with an object,
    // whose `valueOf()` would run at each loop comparison and can return `Infinity`: refuse anything but a count.
    const count: unknown = errors.length;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      fail(`${where}: errors.length must be a non-negative integer, got ${preview(count)}`);
    }
    if (count > MAX_MANIFEST_ERRORS) fail(`${where}: errors has ${count} entries, more than the ${MAX_MANIFEST_ERRORS} supported`);
    for (let i = 0; i < count; i++) {
      const entry: unknown = errors[i];
      if (typeof entry === "string") {
        if (entry === "") fail(`${where}: errors[${i}] must be an error code (a non-empty string) or { status, code }, got ${preview(entry)}`);
        // an older manifest's entry: the code matches any 4xx or 5xx, as before CL8
        declared.push({ code: entry });
        continue;
      }
      if (!isPlainObject(entry)) fail(`${where}: errors[${i}] must be an error code (a non-empty string) or { status, code }, got ${preview(entry)}`);
      const errorStatus: unknown = entry.status;
      const code: unknown = entry.code;
      if (!isFailureStatus(errorStatus)) fail(`${where}: errors[${i}].status must be an integer from 400 to 599, got ${preview(errorStatus)}`);
      if (typeof code !== "string" || code === "") fail(`${where}: errors[${i}].code must be a non-empty string, got ${preview(code)}`);
      declared.push({ status: errorStatus, code });
    }
  }
  // absent fields keep the lenient pre-CL8 behaviour: any 2xx, a body parsed if there is one, codes at any 4xx/5xx
  const success: Success =
    status === undefined && response === undefined
      ? UNKNOWN_SUCCESS
      : { status: status as number | undefined, data: response === undefined ? "any" : response === true ? "json" : "none" };
  return { name: key, method: method as Method, path, success, declared: once(() => declaredOf(declared)) };
};

/**
 * The typed client for a separate-repo FE (S2 option c), from the generated api.ts (`sauf types:generate`):
 * `createClient<AppApi>(manifest)`. The `AppApi` type argument types the calls (without it the client is `never`).
 * The manifest holds each route's method, full path, success status, body flag and declared errors, so the FE loads no
 * contract file of the app and no schema library; `createClient` validates it and throws, naming the key, on a malformed
 * route. A manifest generated before CL8 (no status/response, code strings) keeps the lenient behaviour.
 * It has no response schemas, so `validateResponses` (CL6 #159) is refused: use the appApi, an API node or a contract.
 */
export function createClient<T extends ApiShape<T> = never>(manifest: Manifest, options?: ManifestClientOptions): Client<T>;
/**
 * The manifest client with the type of `options.headers` as the second type argument, since it is not inferred next
 * to an explicit `AppApi`: `createClient<AppApi, { 'x-api-key': string }>(manifest, { headers: { 'x-api-key': key } })`.
 * `options.headers` is then required, so the headers it names are sent.
 */
export function createClient<T extends ApiShape<T>, Hd extends HeadersInit>(
  manifest: Manifest,
  options: ManifestClientOptions<Hd> & { headers: Hd & HeaderValues },
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
  // before the manifest: an endpoint's own fields ({ def }) would pass for a one-route manifest
  if (isEndpoint(api)) return fail("createClient: got a single endpoint; pass its contract, an API node or the appApi");
  if (isContract(api) || isApiNode(api) || isApiRoot(api)) return buildTree(pathsOf(api), send, false, options);
  if (isPlainObject(api)) {
    const routes = manifestRoutes(api);
    if (routes) {
      if (options.validateResponses) {
        fail("createClient: validateResponses needs the contract's response schemas; the generated manifest has none (use the appApi, an API node or a contract)");
      }
      return buildTree(routes, send, true, options);
    }
  } else if (typeof api === "object" && api !== null) {
    // a Map, a Set, a class instance, an array or an object with a set prototype is not a manifest, and must not read as empty
    fail(`createClient: the manifest must be a plain object, got ${kindOf(api)}`);
  }
  return fail("createClient: expected the appApi from defineApi, an API node, a contract or the generated manifest");
}

/**
 * The type-only path-style client: `createPathClient<ApiTypes<AppApi>>({ baseUrl })` then
 * `api.get('/api/users/:user', { params })`. It takes no contract value, so the API type comes from `import type` and
 * the path types the call's input, result and errors (see `client.md › Path-style calls`). It has no contract at
 * runtime, so `validateResponses` (CL6 #159) is refused: use `createClient` with the appApi, an API node or a contract.
 *
 * @example
 * const api = createPathClient<ApiTypes<AppApi>>({ baseUrl: 'https://example.com' })
 * const result = await api.get('/api/users/:user', { params: { user: 1 } })
 */
export function createPathClient<A extends ApiShape<A> = never>(options?: PathClientOptions): PathClient<A>;
/**
 * The path client with the type of `options.headers` as the second type argument, as the manifest client: the headers
 * it statically provides are optional in each call's `headers`. `options.headers` is required, so the client can't
 * claim a header it never sends, and a `headers` function provides none to the types (it is called at each call).
 */
export function createPathClient<A extends ApiShape<A>, Hd extends HeadersInit>(
  options: PathClientOptions<Hd> & { headers: Hd & HeaderValues },
): PathClient<A, ProvidedHeaders<Hd>>;
export function createPathClient(options: ClientOptions = {}): object {
  splitBaseUrl(options.baseUrl ?? "");
  if (options.validateResponses) {
    fail(
      "createPathClient: validateResponses needs the contract's response schemas; a path-style call has no contract at runtime (use createClient with the appApi, an API node or a contract)",
    );
  }
  const send = createSend(options);
  const client: Record<string, unknown> = Object.create(null);
  for (const method of METHODS) {
    client[method] = (path: string, input?: RequestInput) =>
      createCall(send, { name: path, method, path, success: UNKNOWN_SUCCESS }, options)(input);
  }
  return Object.freeze(client) as unknown as PathClient<never>;
}
