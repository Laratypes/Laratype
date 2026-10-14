import { API_NODE, Endpoint, buildUrl, isContract, joinPath } from "@laratype/contract";
import type { ApiNodeInfo, ApiShape, Method } from "@laratype/contract";
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
 * Every call goes through here, so the CL2 result union (#110) only wraps what it resolves to.
 */
const createSend = (options: ClientOptions): Send => {
  const baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
  return (method, path, input = {}) => {
    const url = baseUrl + buildUrl(path, { params: input.params, query: input.query });
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
};

/** Mirrors one node of the tree: a call per endpoint (on the node's full URL prefix), a client per child node. */
function buildNode(node: TreeNode, prefix: string, send: Send): object {
  const client: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(node)) {
    if (value instanceof Endpoint) {
      const { method } = value.def;
      const path = joinPath(prefix, value.def.path);
      client[key] = (input?: RequestInput) => send(method, path, input);
    } else if (isApiNode(value)) {
      client[key] = buildNode(value, (value[API_NODE] as ApiNodeInfo).entry?.path ?? "", send);
    } else {
      fail(`createClient: "${key}" is neither an endpoint nor an API node`);
    }
  }
  return Object.freeze(client);
}

const freezeTree = (node: Record<string, unknown>): object => {
  for (const value of Object.values(node)) if (typeof value === "object") freezeTree(value as Record<string, unknown>);
  return Object.freeze(node);
};

/** Nests the manifest's flat route names: `"users.posts.update"` → `client.users.posts.update`. */
function buildManifest(manifest: Manifest, send: Send): object {
  const root: Record<string, unknown> = Object.create(null);
  for (const [name, route] of Object.entries(manifest)) {
    const segments = name.split(".");
    if (segments.length < 2 || segments.some((s) => s === "")) fail(`createClient: invalid route name "${name}" in the manifest`);
    const key = segments.pop()!;
    let node = root;
    for (const segment of segments) {
      if (typeof node[segment] === "function") fail(`createClient: "${name}" is under the endpoint "${segment}" in the manifest`);
      node = (node[segment] ??= Object.create(null)) as Record<string, unknown>;
    }
    if (node[key] !== undefined) fail(`createClient: "${name}" is both an endpoint and a node in the manifest`);
    const method = route.method.toLowerCase() as Method;
    node[key] = (input?: RequestInput) => send(method, route.path, input);
  }
  return freezeTree(root);
}

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
 * const res = await api.users.posts.update({ params: { user: 1, post: 2 }, body: { title: 'Hi' } })
 */
export function createClient<A extends object>(api: A, options?: ClientOptions): ClientOf<A>;
export function createClient(api: object, options: ClientOptions = {}): object {
  const send = createSend(options);
  if (isContract(api)) return buildNode(api as unknown as TreeNode, "", send);
  if (isApiNode(api)) return buildNode(api, (api[API_NODE] as ApiNodeInfo).entry?.path ?? "", send);
  if (isApiRoot(api)) return buildNode(api, "", send);
  if (isManifest(api)) return buildManifest(api, send);
  return fail("createClient: expected the appApi from defineApi, an API node, a contract or the generated manifest");
}
