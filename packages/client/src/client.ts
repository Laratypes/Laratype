import { API_NODE, apiPaths, buildUrl, isContract, isEndpoint, joinPath } from "@laratype/contract";
import type { Api, ApiNodeInfo, ApiPath, ApiShape, Method } from "@laratype/contract";
import type { CheckGroupKeys, Client, ClientOf, ClientOptions, Manifest, ManifestRoute } from "./types";

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

const isApiNode = (value: unknown): value is TreeNode =>
  typeof value === "object" && value !== null && typeof (value as TreeNode)[API_NODE] === "object";

/**
 * An object of API nodes and contracts: the `defineApi` root (which carries no brand of its own) or a hand-made
 * group such as `{ posts: appApi.users.posts, users: usersContract }`.
 */
const isApiGroup = (value: unknown): value is TreeNode =>
  typeof value === "object" &&
  value !== null &&
  !isContract(value) &&
  Object.values(value).every((v) => isApiNode(v) || isContract(v));

const isManifestRoute = (value: unknown): value is ManifestRoute =>
  typeof value === "object" && value !== null && typeof (value as ManifestRoute).method === "string" && typeof (value as ManifestRoute).path === "string";

/** The generated manifest: a flat map of routes keyed by route name. */
const isManifest = (value: unknown): value is Manifest =>
  typeof value === "object" && value !== null && Object.values(value).every(isManifestRoute);

/** `"https://host/api"` → `["https://host", "/api"]`; a relative `baseUrl` (`"/api"`) is all path. */
const splitBaseUrl = (baseUrl: string): [origin: string, path: string] => {
  const base = baseUrl.replace(/\/+$/, "");
  const origin = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i.exec(base)?.[0] ?? "";
  return [origin, base.slice(origin.length)];
};

/**
 * One request: the full contract path filled by `buildUrl`, the headers and the JSON body, sent with the injected fetch.
 * `baseUrl`'s path is joined to the route path with the server's `joinPath` before `buildUrl` fills it, so a single
 * contract's `"/"` route under `https://host/api/users` is `/api/users`, not `/api/users/` (a 404 under strict routing).
 * Async, so every failure (a missing param, a body JSON cannot hold, no fetch) rejects instead of throwing.
 * `baseUrl`, `headers` and `fetch` are read from `options` at each call, so changing them (a refreshed token) applies.
 * Every call goes through here, so the CL2 result union (#110) only wraps what it resolves to.
 */
const createSend = (options: ClientOptions): Send => async (method, path, input = {}) => {
  const [origin, basePath] = splitBaseUrl(options.baseUrl ?? "");
  const url = origin + buildUrl(joinPath(basePath, path), { params: input.params, query: input.query });
  const headers = new Headers(options.headers);
  let ownContentType = false;
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (value === undefined) continue;
    headers.set(key, value);
    if (key.toLowerCase() === "content-type") ownContentType = true;
  }
  const init: RequestInit = { method: method.toUpperCase(), headers };
  if (input.body !== undefined) {
    init.body = JSON.stringify(input.body);
    // only the call's own headers opt out of JSON: a default content-type in options.headers does not
    if (!ownContentType) headers.set("content-type", "application/json");
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
 * The routes of a contract or an API node from `apiPaths()`: names, methods and full paths, without resolving
 * capabilities (the client doesn't need them, and a contract alone lacks its folder scopes).
 * An API node's names are relative to it, under `as`: `appApi.users` → `"index"`, `"posts.update"`.
 */
const pathsOf = (api: object, as = ""): RouteSpec[] => {
  const prefix = isApiNode(api) ? `${(api[API_NODE] as ApiNodeInfo).name}.` : "";
  return (apiPaths(api as unknown as Api) as ApiPath[]).map((r) => ({
    name: as + r.name.slice(prefix.length),
    method: r.method,
    path: r.path,
  }));
};

/** One key of an API group: a "." would split into nested names at runtime while the type keeps `client["a.b"]`. */
const groupPaths = (key: string, value: TreeNode): RouteSpec[] => {
  if (key.includes(".")) fail(`createClient: key "${key}" must not contain "." (names are split on ".")`);
  return pathsOf(value, `${key}.`);
};

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
 * `baseUrl`'s path is joined to its endpoint paths like the server's `joinPath`.
 *
 * @example
 * const api = createClient(appApi, { baseUrl: 'https://example.com' })
 * const res = await api.users.posts.update({ params: { user: 1, post: 2 }, body: { title: 'Hi' } })
 */
export function createClient<A extends object>(api: A & CheckGroupKeys<A>, options?: ClientOptions): ClientOf<A>;
export function createClient(api: object, options: ClientOptions = {}): object {
  const send = createSend(options);
  // before isManifest: an endpoint's own fields ({ def }) would pass for a one-route manifest
  if (isEndpoint(api)) return fail("createClient: got a single endpoint; pass its contract, an API node or the appApi");
  if (isContract(api) || isApiNode(api)) return buildTree(pathsOf(api), send, false);
  // names follow the object's own keys, as `ClientOf<A>` does: the appApi root's keys are its node names, and a
  // hand-made `{ posts: appApi.users.posts, users: usersContract }` gives `api.posts.update` and `api.users.index`
  if (isApiGroup(api)) return buildTree(Object.entries(api).flatMap(([key, value]) => groupPaths(key, value as TreeNode)), send, false);
  if (isManifest(api)) return buildTree(Object.entries(api).map(([name, route]) => ({ name, ...route })), send, true);
  return fail("createClient: expected the appApi from defineApi, an API node, a contract or the generated manifest");
}
