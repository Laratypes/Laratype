import { API_NODE, apiPaths, buildUrl, isContract, isEndpoint, joinPath } from "@laratype/contract";
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

/** One call of the client: its route name relative to the client root (`"users.posts.update"`), method and full path. */
interface RouteSpec {
  readonly name: string;
  readonly method: string;
  readonly path: string;
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

/** `"https://host/api"` → `["https://host", "/api"]`; a relative `baseUrl` (`"/api"`) is all path. No query or hash. */
const splitBaseUrl = (baseUrl: string): [origin: string, path: string] => {
  if (/[?#]/.test(baseUrl)) fail(`createClient: baseUrl "${baseUrl}" must not have a query or a hash`);
  const base = baseUrl.replace(/\/+$/, "");
  const origin = /^[a-z][a-z\d+.-]*:\/\/[^/]*/i.exec(base)?.[0] ?? "";
  return [origin, base.slice(origin.length)];
};

/**
 * One request: the route path filled by `buildUrl`, the headers and the JSON body, sent with the injected fetch.
 * `buildUrl` only sees the route path; the result is then joined to `baseUrl`'s path with the server's `joinPath`, so
 * `baseUrl` is never parsed as route syntax, and a single contract's `"/"` route under `https://host/api/users` is
 * `/api/users`, not `/api/users/` (a 404 under strict routing).
 * Headers: the call's own, then `options.headers`, then `content-type: application/json` for a body.
 * Async, so every failure (a missing param, a body JSON cannot hold, no fetch) rejects instead of throwing.
 * `baseUrl`, `headers` and `fetch` are read from `options` at each call, so changing them (a refreshed token) applies.
 * Every call goes through here, so the CL2 result union (#110) only wraps what it resolves to.
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
  const fetchFn = options.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== "function") fail("no fetch available: pass options.fetch");
  return fetchFn(url, init);
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
  for (const { name, method, path } of routes) {
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
    const m = method.toLowerCase() as Method;
    node[key] = (input?: RequestInput) => send(m, path, input);
  }
  return freezeTree(root);
}

/**
 * The routes of the appApi root, an API node or a contract from `apiPaths()`: names, methods and full paths, without
 * resolving capabilities (the client doesn't need them, and a contract alone lacks its folder scopes).
 * An API node's names are relative to it: `appApi.users` → `"index"`, `"posts.update"`.
 */
const pathsOf = (api: object): RouteSpec[] => {
  const prefix = isApiNode(api) ? `${(api[API_NODE] as ApiNodeInfo).name}.` : "";
  return (apiPaths(api as unknown as Api) as ApiPath[]).map((r) => ({ name: r.name.slice(prefix.length), method: r.method, path: r.path }));
};

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
 * const res = await api.users.posts.update({ params: { user: 1, post: 2 }, body: { title: 'Hi' } })
 */
export function createClient<A extends ApiRootShape<A>>(api: A, options?: ClientOptions): ClientOf<A>;
export function createClient(api: object, options: ClientOptions = {}): object {
  splitBaseUrl(options.baseUrl ?? "");
  const send = createSend(options);
  // before isManifest: an endpoint's own fields ({ def }) would pass for a one-route manifest
  if (isEndpoint(api)) return fail("createClient: got a single endpoint; pass its contract, an API node or the appApi");
  if (isContract(api) || isApiNode(api) || isApiRoot(api)) return buildTree(pathsOf(api), send, false);
  if (isManifest(api)) return buildTree(Object.entries(api).map(([name, route]) => ({ name, ...route })), send, true);
  return fail("createClient: expected the appApi from defineApi, an API node, a contract or the generated manifest");
}
