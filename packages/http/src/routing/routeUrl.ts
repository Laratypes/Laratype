import type { API_ROOT, ApiEndpoint, ApiRouteName, EndpointTypes, NodeContext, PathParams } from "@laratype/contract";
import { buildUrl, joinPath } from "@laratype/contract";
import { config } from "@laratype/core";
import type { ApiRoutes } from "./api/ApiRouter";
import type { AdHocRouteEntry, MountedRoute, RouteEntry } from "./api/types";

/**
 * The app's route names, filled once by module augmentation (docs/v1/http.md › Route names and URLs):
 *
 * @example
 * declare module '@laratype/http' {
 *   interface Register { routes: typeof apiRoutes }
 * }
 */
export interface Register {}

/** The `Route.api(appApi, (r) => [...])` group the app registered with `Register`. */
type RegisteredRoutes<R> = R extends { readonly routes: infer T } ? T : never;

/** The API tree node an endpoint name ends in: `"users.posts.update"` stops at the `posts` node. */
type NodeAt<A, Name extends string> = Name extends `${infer H}.${infer T}`
  ? H extends keyof A
    ? NodeAt<A[H], T>
    : never
  : A;

/** One route's types: the endpoint under the node its name belongs to, with its full path, params and query. */
type RouteTypes<A, Name extends string> = EndpointTypes<ApiEndpoint<A, Name>, NodeContext<NodeAt<A, Name>>>;

/** The names `.name()` gave the ad-hoc routes of a mounted group, or `undefined` for an unnamed one. */
type AdHocRouteName<M> = M extends readonly unknown[]
  ? M[number] extends infer I ? (I extends MountedRoute<any, any, any, infer N> ? N : never) : never
  : never;

/** The path params of the ad-hoc route of a mounted group named `Name`, from its path. */
type AdHocRouteParams<M, Name extends string> = M extends readonly unknown[]
  ? M[number] extends infer I ? (I extends MountedRoute<any, infer P, any, Name> ? PathParams<P> : never) : never
  : never;

/** The contract route names of the API tree a group was mounted for. */
type ContractRouteName<A> = A extends { readonly [API_ROOT]: true } ? ApiRouteName<A> : never;

/** A path param value: a string, a number or a bigint, or a model whose route key is used (see `RouteKeyed`). */
export type RouteParamValue = string | number | bigint | RouteKeyed;

/** Every value of a path, widened to what `route()` accepts. */
type WidenParams<P> = { [K in keyof P]: RouteParamValue };

/** The params and query of a route name: the contract endpoint's, or the ad-hoc route's `object` query. */
type RouteInputs<R, Name extends string> = [RegisteredRoutes<R>] extends [never]
  ? { params: Record<string, RouteParamValue>; query: object }
  : RegisteredRoutes<R> extends ApiRoutes<infer A, infer M>
    ? | (Name extends ContractRouteName<A>
        ? { params: WidenParams<RouteTypes<A, Name>["params"]>; query: RouteTypes<A, Name>["query"] }
        : never)
      | (Name extends Extract<AdHocRouteName<M>, string>
          ? { params: WidenParams<AdHocRouteParams<M, Name>>; query: object }
          : never)
    : { params: Record<string, RouteParamValue>; query: object };

/**
 * Every route name the app registered: the contract names of its API tree and the ad-hoc routes named with `.name()`.
 * Without a registration, any name: `route()` then takes generic params (the `config()` precedent).
 */
export type RouteName<R = Register> = [RegisteredRoutes<R>] extends [never]
  ? string
  : RegisteredRoutes<R> extends ApiRoutes<infer A, infer M>
    ? ContractRouteName<A> | Extract<AdHocRouteName<M>, string>
    : string;

/** The path params of a route name, folder `[x]` params included; `string | number | bigint | RouteKeyed` values. */
export type RouteParamsOf<Name extends string, R = Register> = RouteInputs<R, Name>["params"];

/** The query of a route name: the endpoint's query schema input, or `object` for an ad-hoc route. */
export type RouteQueryOf<Name extends string, R = Register> = RouteInputs<R, Name>["query"];

/** The `options` of `route()`: query serialized by `buildUrl`, and whether the URL is absolute. */
export interface RouteUrlOptions<Query = object> {
  /** Serialized by `buildUrl`: `undefined` and `null` are skipped, an array repeats its key, a `Date` is ISO 8601. */
  readonly query?: Query;
  /** `true` prefixes `config('config.url')`: `"https://app.test/api/users/1"`. Default: the path as mounted. */
  readonly absolute?: boolean;
}

/** The `params` argument of `route()`: required when the path has a required param (`buildUrl`'s rule). */
export type RouteArgs<Name extends string, R = Register> = {} extends RouteParamsOf<Name, R>
  ? [params?: RouteParamsOf<Name, R>, options?: RouteUrlOptions<RouteQueryOf<Name, R>>]
  : [params: RouteParamsOf<Name, R>, options?: RouteUrlOptions<RouteQueryOf<Name, R>>];

/**
 * A model a path param accepts (H13 #162): it contributes its route key, the property its class's `routeKeyName`
 * names (or `primaryKey`) at the model layer (database.md › BindableModel). H14
 * [#163](https://github.com/Laratypes/Laratype/issues/163) adds `getRouteKey()` to the model base; until then, a model
 * instance with it (or any object with it) passes.
 */
export interface RouteKeyed {
  /**
   * The route key value, a string, a number or a bigint (DB1 [#145](https://github.com/Laratypes/Laratype/issues/145)
   * returns a bigint for a bigint key): it is converted with `String()` before `buildUrl` encodes it.
   */
  getRouteKey(): string | number | bigint;
}

/** One registered route name: the full path it builds, and what a duplicate-name error calls it. */
interface RegisteredRoute {
  readonly path: string;
  readonly label: string;
  readonly adHoc: boolean;
}

/**
 * Every route name a `Route.api()` group mounted, in this process. Contract routes merge by name: the latest mount of
 * a name points it at its path, without an error (the same tree in two groups). A name only one route may take is the
 * ad-hoc one: `.name()` of another route, in this group or a later `Route.api()` call, is a duplicate error. A group
 * mounted again in the same process (an `--hmr` restart) is the same route, not a duplicate.
 */
const registry = new Map<string, RegisteredRoute>();

const labelOf = (entry: { readonly method: string; readonly path: string }) => `r.${entry.method}('${entry.path}')`;

/**
 * Registers the names of one `Route.api()` group for `route()`: every contract route and every ad-hoc route with
 * `.name()`. The group is checked on a copy and committed only once all of it passes: a duplicate later in the group
 * throws, and a group that never mounts leaves no name behind for `route()`. Called by `Route.api()`; not exported by
 * the package.
 * @internal
 */
export const registerRoutes = (entries: readonly (RouteEntry | AdHocRouteEntry)[]): void => {
  const next = new Map(registry);
  for (const entry of entries) {
    const { name } = entry;
    if (name === undefined) continue;
    const existing = next.get(name);
    if (entry.controller !== undefined) {
      // A contract route of the tree: a later group agrees on the name, so it points the name at the path it mounts
      if (existing?.adHoc) fail(`Route.api: contract "${name}" has the name of ${existing.label}`);
      next.set(name, { path: entry.path, label: name, adHoc: false });
      continue;
    }
    const label = labelOf(entry);
    // The same group mounting again (an --hmr restart) is the same route, not a duplicate
    if (existing?.adHoc === true && existing.label === label) continue;
    if (existing !== undefined) {
      fail(`Route.api: ${label}.name(${JSON.stringify(name)}) is already the name of ${existing.label}`);
    }
    next.set(name, { path: entry.path, label, adHoc: true });
  }
  // The whole group passed: commit its names at once
  registry.clear();
  for (const [name, route] of next) registry.set(name, route);
};

/**
 * Forgets every registered name: for tests, so a route name does not leak between them. Not exported by the package.
 * @internal
 */
export const resetRouteRegistry = (): void => {
  registry.clear();
};

function fail(message: string): never {
  throw new TypeError(`[@laratype/http] ${message}`);
}

/** A name echoed in a diagnostic: a 100 KB name must not build a 100 KB message. */
const truncateName = (name: string, max = 100): string => (name.length > max ? `${name.slice(0, max)}…` : name);

/**
 * `config('config.url')` as an origin with an optional path prefix, its trailing slashes dropped. The app reads the
 * 0.5 single config file; K1 #152's `app/config/app.ts` makes it `config('app.url')`.
 */
const appUrl = (): string => {
  const value: unknown = (config as unknown as (path: string) => unknown)("config.url");
  const url = typeof value === "string" ? value : value instanceof URL ? value.toString() : undefined;
  if (url === undefined || url.trim() === "") {
    fail("route: absolute URLs need config('config.url') (app.url), which is not set");
  }
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  // The config value is the only origin source: the request's Host header never reaches an absolute URL
  const problem =
    parsed === undefined ||
    !/^https?:$/.test(parsed.protocol) ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== "";
  if (problem) {
    const got = JSON.stringify(url);
    fail(`route: config('config.url') must be an absolute http(s) URL without a query, hash or credentials, got ${got}`);
  }
  // The parsed origin and path, so a trailing "?", "#", a credential or a space in the config never reaches a URL
  // (`problem` above proves `parsed` is defined here)
  const base = parsed!;
  return `${base.origin}${base.pathname}`.replace(/\/+$/, "");
};

/**
 * The path params as `buildUrl` takes them: a `RouteKeyed` value contributes its route key and a bigint is
 * converted with `String()`; any other object is a mistake (a raw object would be sent as `[object Object]`).
 */
const paramValues = (params: object | undefined): Record<string, string | number> => {
  const values: Record<string, string | number> = Object.create(null);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === "bigint") {
      values[key] = String(value);
      continue;
    }
    if (typeof value !== "object") {
      values[key] = value as string | number;
      continue;
    }
    const getRouteKey = (value as Partial<RouteKeyed>).getRouteKey;
    if (typeof getRouteKey !== "function") {
      fail(`route: param "${key}" got an object that is not a model (no getRouteKey())`);
    }
    const routeKey = getRouteKey.call(value);
    values[key] = typeof routeKey === "bigint" ? String(routeKey) : (routeKey as string | number);
  }
  return values;
};

/**
 * `route()` without its type-level names: the built URL for a registered name. Used by `route()` and
 * `redirect().route()`; not exported by the package.
 * @internal
 */
export const buildRouteUrl = (
  name: string,
  params?: object,
  options?: { readonly query?: object | undefined; readonly absolute?: boolean },
): string => {
  if (registry.size === 0) fail("route: no routes are registered (call Route.api(appApi, ...) first)");
  const entry = registry.get(name);
  if (entry === undefined) fail(`route: unknown route name ${JSON.stringify(truncateName(name))}`);
  // buildUrl is the one encoder: params with encodeURIComponent, query with URLSearchParams
  const path = buildUrl(entry.path, { params: paramValues(params), query: options?.query });
  return options?.absolute ? joinPath(appUrl(), path) : path;
};

/**
 * Builds a URL from the name of a mounted route (docs/v1/http.md › Route names and URLs):
 * `route('users.posts.update', { user, post }, { query: { page: 2 } })` → `"/api/users/1/posts/2?page=2"`.
 * - Names come from the app's `Register` augmentation; params are typed from the full path, folder `[x]` params
 *   included, and a param takes a model through `RouteKeyed`.
 * - `{ absolute: true }` prefixes `config('config.url')`. The config value is the only origin source: the request's
 *   `Host` header never reaches it.
 * - An unknown name, an object param that is not a model, and a missing absolute-URL config throw; params and query
 *   are encoded by `buildUrl`, whose diagnostics propagate.
 */
export function route<const Name extends RouteName>(name: Name, ...args: RouteArgs<Name>): string {
  return buildRouteUrl(name, args[0], args[1]);
}
