import { API_NODE, CONTRACT, apiPaths, buildUrl, endpointErrors, isContract, isEndpoint } from "@laratype/contract";
import type { Api, ApiNodeInfo, ApiPath, ApiShape, Method } from "@laratype/contract";
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

/** The error codes a route declares, with their status (`undefined` when only the code is known, as in the manifest). */
type Declared = ReadonlyMap<string, number | undefined>;

/** One call of the client: its route name relative to the client root (`"users.posts.update"`), method, full path and declared errors. */
interface RouteSpec {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly declared: Declared;
}

/** The runtime view of `ClientResult`. */
type Result =
  | { ok: true; status: number; data: unknown; response: Response }
  | { ok: false; status: number; code: string; error: unknown; response: Response }
  | { ok: false; unexpected: true; status: number; error: unknown; response: Response | undefined };

type Call = (input?: RequestInput) => Promise<Result>;

/** A rejected `fetch` (network failure, abort), told apart from the programming errors `send` also rejects with. */
class FetchFailed {
  constructor(readonly cause: unknown) {}
}

type TreeNode = Readonly<Record<string | symbol, unknown>>;

const isApiNode = (value: unknown): value is TreeNode =>
  typeof value === "object" && value !== null && typeof (value as TreeNode)[API_NODE] === "object";

/** The `defineApi` root holds API nodes only and carries no brand of its own. */
const isApiRoot = (value: unknown): value is TreeNode =>
  typeof value === "object" && value !== null && !isContract(value) && Object.values(value).every(isApiNode);

const isManifestRoute = (value: unknown): value is ManifestRoute =>
  typeof value === "object" && value !== null && typeof (value as ManifestRoute).method === "string" && typeof (value as ManifestRoute).path === "string";

/** The generated manifest: a flat map of routes keyed by route name. */
const isManifest = (value: unknown): value is Manifest =>
  typeof value === "object" && value !== null && Object.values(value).every(isManifestRoute);

/**
 * One request: the full contract path filled by `buildUrl`, the headers and the JSON body, sent with the injected fetch.
 * Async, so every failure (a missing param, a body JSON cannot hold, no fetch) rejects instead of throwing.
 * A rejected `fetch` rejects with `FetchFailed`, so the result union can turn it into `unexpected`.
 * `baseUrl`, `headers` and `fetch` are read from `options` at each call, so changing them (a refreshed token) applies.
 */
/**
 * `baseUrl` + route path, joined like the server's `joinPath`: a route path of `"/"` is `baseUrl` itself, so a single
 * contract's index under `https://host/api/users` is `/api/users`, not `/api/users/` (a 404 under strict routing).
 */
const joinUrl = (baseUrl: string, url: string): string => {
  const base = baseUrl.replace(/\/+$/, "");
  return base && (url === "/" || url.startsWith("/?")) ? base + url.slice(1) : base + url;
};

const createSend = (options: ClientOptions): Send => async (method, path, input = {}) => {
  const url = joinUrl(options.baseUrl ?? "", buildUrl(path, { params: input.params, query: input.query }));
  const own = new Headers();
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (value !== undefined) own.set(key, value);
  }
  const headers = new Headers(options.headers);
  own.forEach((value, key) => headers.set(key, value));
  const init: RequestInit = { method: method.toUpperCase(), headers };
  if (input.body !== undefined) {
    init.body = JSON.stringify(input.body);
    // only the call's own headers opt out of JSON: a default content-type in options.headers does not
    if (!own.has("content-type")) headers.set("content-type", "application/json");
  }
  if (input.signal) init.signal = input.signal;
  const fetchFn = options.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== "function") fail("no fetch available: pass options.fetch");
  try {
    return await fetchFn(url, init);
  } catch (error) {
    throw new FetchFailed(error);
  }
};

const unexpected = (status: number, error: unknown, response: Response | undefined): Result => ({ ok: false, unexpected: true, status, error, response });

/**
 * Reads the response into the result union. The body is read from a clone, so `response` stays unread.
 * - A body that isn't JSON is unexpected; an empty body parses to `undefined`.
 * - 2xx: `ok: true`.
 * - Otherwise the wire format is `{ code, ...body }`: a declared code (with its status, when known) is a declared
 *   error whose `error` is the body without `code`; anything else is unexpected.
 */
async function toResult(response: Response, declared: Declared): Promise<Result> {
  let body: unknown;
  try {
    const text = await response.clone().text();
    body = text === "" ? undefined : JSON.parse(text);
  } catch (error) {
    return unexpected(response.status, error, response);
  }
  if (response.ok) return { ok: true, status: response.status, data: body, response };
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const { code, ...error } = body as Record<string, unknown>;
    if (typeof code === "string" && declared.has(code)) {
      const status = declared.get(code);
      if (status === undefined || status === response.status) return { ok: false, status: response.status, code, error, response };
    }
  }
  return unexpected(response.status, body, response);
}

/**
 * One endpoint call: `send` wrapped into the result union. A network failure or an abort resolves as unexpected
 * (`status: 0`); a programming error, such as a missing required param, still rejects.
 */
const createCall = (send: Send, method: Method, path: string, declared: Declared): Call => async (input) => {
  let response: Response;
  try {
    response = await send(method, path, input);
  } catch (error) {
    if (error instanceof FetchFailed) return unexpected(0, error.cause, undefined);
    throw error;
  }
  return toResult(response, declared);
};

const freezeTree = (node: Record<string, unknown>): object => {
  for (const value of Object.values(node)) if (typeof value === "object") freezeTree(value as Record<string, unknown>);
  return Object.freeze(node);
};

/**
 * Nests flat route names into the client: `"users.posts.update"` → `client.users.posts.update`.
 * The one builder for every input: the routes come from `apiPaths()` or from the generated manifest.
 */
function buildTree(routes: readonly RouteSpec[], send: Send, where: string): object {
  const root: Record<string, unknown> = Object.create(null);
  for (const { name, method, path, declared } of routes) {
    const segments = name.split(".");
    // manifest names are full route names (folder + endpoint key); apiPaths names are valid by construction
    if (segments.some((s) => s === "") || (where && segments.length < 2)) fail(`createClient: invalid route name "${name}"${where}`);
    const key = segments.pop()!;
    let node = root;
    for (const segment of segments) {
      if (typeof node[segment] === "function") fail(`createClient: "${name}" is under the endpoint "${segment}"${where}`);
      node = (node[segment] ??= Object.create(null)) as Record<string, unknown>;
    }
    if (node[key] !== undefined) fail(`createClient: "${name}" is both an endpoint and a node${where}`);
    node[key] = createCall(send, method.toLowerCase() as Method, path, declared);
  }
  return freezeTree(root);
}

/**
 * The routes of a contract or an API node from `apiPaths()`: names, methods and full paths. Each declares its errors
 * with `endpointErrors` (derived from every level, plus `throws`), which never throws: a contract alone lacks its
 * folder scopes, so the consistency check of `resolveCapabilities` doesn't apply.
 * An API node's names are relative to it, under `as`: `appApi.users` → `"index"`, `"posts.update"`.
 */
const pathsOf = (api: object, as = ""): RouteSpec[] => {
  const prefix = isApiNode(api) ? `${(api[API_NODE] as ApiNodeInfo).name}.` : "";
  return (apiPaths(api as unknown as Api) as ApiPath[]).map((r) => {
    const errors = endpointErrors(r.endpoint.def, { path: r.prefix, scopes: r.scopes, options: r.contract[CONTRACT].options });
    return {
      name: as + r.name.slice(prefix.length),
      method: r.method,
      path: r.path,
      declared: new Map(errors.map((e) => [e.code, e.status])),
    };
  });
};

/** The manifest's routes; it knows the error codes only, not their status. */
const manifestRoutes = (manifest: Manifest): RouteSpec[] =>
  Object.entries(manifest).map(([name, route]) => ({
    name,
    method: route.method,
    path: route.path,
    declared: new Map((route.errors ?? []).map((code) => [code, undefined])),
  }));

/**
 * The typed client for a separate-repo FE (S2 option c), from the generated api.ts (`sauf types:generate`):
 * `createClient<AppApi>(manifest)`. The `AppApi` type argument types the calls (without it the client is `never`).
 * The manifest holds each route's method and full path, so the FE loads no contract file of the app and no schema library.
 */
export function createClient<T extends ApiShape<T> = never>(manifest: Manifest, options?: ClientOptions): Client<T>;
/**
 * The typed client for an API: `createClient(appApi)` with the generated `appApi` (`$api`), an API node
 * (`appApi.users`) or a single contract file. Names follow the folder tree (`api.users.posts.update(...)`) and
 * URLs are the contracts' full paths, so `baseUrl` is only the origin. A single contract has no folder prefix:
 * its endpoint paths are appended to `baseUrl` as they are.
 *
 * @example
 * const api = createClient(appApi, { baseUrl: 'https://example.com' })
 * const result = await api.users.posts.update({ params: { user: 1, post: 2 }, body: { title: 'Hi' } })
 */
export function createClient<A extends object>(api: A, options?: ClientOptions): ClientOf<A>;
export function createClient(api: object, options: ClientOptions = {}): object {
  const send = createSend(options);
  // before isManifest: an endpoint's own fields ({ def }) would pass for a one-route manifest
  if (isEndpoint(api)) return fail("createClient: got a single endpoint; pass its contract, an API node or the appApi");
  if (isContract(api) || isApiNode(api)) return buildTree(pathsOf(api), send, "");
  // names follow the object's own keys, as `ClientOf<A>` does: the appApi root's keys are its node names, and a
  // hand-made `{ posts: appApi.users.posts }` gives `api.posts.update`
  if (isApiRoot(api)) return buildTree(Object.entries(api).flatMap(([key, node]) => pathsOf(node as TreeNode, `${key}.`)), send, "");
  if (isManifest(api)) return buildTree(manifestRoutes(api), send, " in the manifest");
  return fail("createClient: expected the appApi from defineApi, an API node, a contract or the generated manifest");
}
