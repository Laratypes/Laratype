import type { API_NODE, AnyContract, AnyEndpoint, ApiEntry, ApiNodeInfo, ApiRoute } from "@laratype/contract";
import type Middleware from "../../middleware/Middleware";

/**
 * Type side of `Route.api` (docs/v1/http.md › Router v2). It reads the API tree built by `defineApi`
 * (`typeof appApi`) and checks the mounted routes: every contract once, and a policy on every scope with `authorize`.
 */

/** A controller class. It is still built with `new` until H2 #105 resolves it from the container. */
export type ControllerClass = new (...args: any[]) => object;

/** A policy class. Mounted policies are recorded on the registry; running them is H2 #105 / A3 #121. */
export type PolicyClass = abstract new (...args: any[]) => object;

export type MiddlewareClass = typeof Middleware;

/** `r.contract(contract, Controller)`: every endpoint of the contract, bound to the controller method of the same key. */
export interface MountedContract<C extends AnyContract = AnyContract> {
  readonly kind: "contract";
  readonly contract: C;
  readonly controller: ControllerClass;
  readonly middleware: readonly MiddlewareClass[];
}

/** `r.scope('<folder>', { policy })`: the policy for the `_scope.ts` of that folder. */
export interface MountedScope<D extends string = string> {
  readonly kind: "scope";
  readonly dir: D;
  readonly policy: PolicyClass;
  /** Runs before the middleware of every contract under the folder. */
  readonly middleware: readonly MiddlewareClass[];
}

export type ApiRouteItem = MountedContract | MountedScope;

export interface ScopeRouteOptions {
  readonly policy: PolicyClass;
}

// ---- reading the API tree ---------------------------------------------------

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

type NodeEntry<N> = N extends { readonly [API_NODE]: ApiNodeInfo<infer Name, infer En> }
  ? En extends ApiEntry<infer C, any, infer S, infer D> ? { name: Name; contract: C; scopes: S; dirs: D } : never
  : never;

/** Every mounted contract of an API tree: `{ name, contract, scopes, dirs }`, one member per tree name. */
export type ApiTreeEntry<A> = { [K in keyof A & string]: A[K] extends AnyEndpoint ? never : NodeEntry<A[K]> | ApiTreeEntry<A[K]> }[keyof A & string];

/** Tree names of the contracts: `"users" | "users.posts"`. */
export type ApiTreeName<A> = ApiTreeEntry<A> extends infer E ? (E extends { name: infer N } ? N : never) : never;

/** The contracts of an API tree. */
export type ApiTreeContract<A> = ApiTreeEntry<A> extends infer E ? (E extends { contract: infer C } ? C : never) : never;

type ScopePairs<E> = E extends { scopes: infer S extends readonly unknown[]; dirs: infer D extends readonly string[] }
  ? { [I in keyof S]: { dir: D[I & keyof D]; authorize: S[I] extends { readonly authorize: true } ? true : false } }[number]
  : never;

/** The scope folders of an API tree: `"" | "users/[user]"`. */
export type ApiScopeDir<A> = ScopePairs<ApiTreeEntry<A>> extends infer P ? (P extends { dir: infer D } ? D : never) : never;

/** The scope folders whose `_scope.ts` has `authorize`: each needs `r.scope('<folder>', { policy })`. */
export type ApiAuthorizeDir<A> = ScopePairs<ApiTreeEntry<A>> extends infer P ? (P extends { dir: infer D; authorize: true } ? D : never) : never;

// ---- checking the mounted routes ----------------------------------------------

/** Tree names whose contract has exactly the type `C`. Two contracts with identical types share their names. */
type NamesOf<A, C> = ApiTreeEntry<A> extends infer E ? (E extends { name: infer N; contract: infer EC } ? (Equal<EC, C> extends true ? N : never) : never) : never;

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

type ContractCount<M, C> = M extends readonly [infer H, ...infer R]
  ? H extends MountedContract<infer HC> ? (Equal<HC, C> extends true ? [1, ...ContractCount<R, C>] : ContractCount<R, C>) : ContractCount<R, C>
  : [];

type DirCount<M, D> = M extends readonly [infer H, ...infer R]
  ? H extends MountedScope<infer HD> ? (Equal<HD, D> extends true ? [1, ...DirCount<R, D>] : DirCount<R, D>) : DirCount<R, D>
  : [];

type Item<M extends readonly unknown[]> = M[number];

type Unknown<A, M extends readonly unknown[]> = Item<M> extends infer I ? (I extends MountedContract<infer C> ? ([NamesOf<A, C>] extends [never] ? true : never) : never) : never;

type MountedNames<A, M extends readonly unknown[]> = Item<M> extends infer I ? (I extends MountedContract<infer C> ? NamesOf<A, C> : never) : never;

type Missing<A, M extends readonly unknown[]> = Exclude<ApiTreeName<A>, MountedNames<A, M>>;

/** A contract mounted twice. Skipped when several contracts share its type (the runtime check catches those). */
type Twice<A, M extends readonly unknown[]> = Item<M> extends infer I
  ? I extends MountedContract<infer C>
    ? ContractCount<M, C>["length"] extends 0 | 1 ? never : true extends IsUnion<NamesOf<A, C>> ? never : NamesOf<A, C>
    : never
  : never;

type MountedDirs<M extends readonly unknown[]> = Item<M> extends infer I ? (I extends MountedScope<infer D> ? D : never) : never;

type NoPolicy<A, M extends readonly unknown[]> = Exclude<ApiAuthorizeDir<A>, MountedDirs<M>>;

type ScopeTwice<M extends readonly unknown[]> = Item<M> extends infer I
  ? I extends MountedScope<infer D> ? (DirCount<M, D>["length"] extends 0 | 1 ? never : D) : never
  : never;

type Err<T extends string> = { error: `Route.api: ${T}` };

/** `unknown` when the routes mount the tree correctly, otherwise `{ error }` naming the problem. */
export type CheckApiRoutes<A, M extends readonly unknown[]> =
  [Unknown<A, M>] extends [never]
    ? [Missing<A, M>] extends [never]
      ? [Twice<A, M>] extends [never]
        ? [NoPolicy<A, M>] extends [never]
          ? [ScopeTwice<M>] extends [never]
            ? unknown
            : Err<`scope "${ScopeTwice<M> & string}" is mounted twice`>
          : Err<`scope "${NoPolicy<A, M> & string}" has authorize but no policy (add r.scope() with { policy })`>
        : Err<`contract "${Twice<A, M> & string}" is mounted twice`>
      : Err<`contract "${Missing<A, M> & string}" is not mounted (add r.contract())`>
    : Err<"a mounted contract is not in the API tree">;

/** The `r` of `Route.api(appApi, (r) => [...])`. */
export interface ApiRouteBuilder<A> {
  /** Route middleware (0.5 classes) for the contracts or scope mounted from the returned builder. */
  middleware(...middleware: MiddlewareClass[]): ApiRouteBuilder<A>;
  /** Mounts every endpoint of `contract` on the controller method of the same key. */
  contract<C extends ApiTreeContract<A>>(contract: C, controller: ControllerClass): MountedContract<C>;
  /** Mounts the policy for the `_scope.ts` of `dir` (root-relative, `""` for the root). */
  scope<D extends ApiScopeDir<A>>(dir: D, options: ScopeRouteOptions): MountedScope<D>;
}

/** One route registry entry: the contract route plus how it is served. Read by `sauf route:list`. */
export interface RouteEntry extends ApiRoute {
  /** The controller class and the method, named after the endpoint key. */
  readonly controller: readonly [ControllerClass, string];
  /** Scope middleware (outer to inner), then the contract's. */
  readonly middleware: readonly MiddlewareClass[];
  /** Policies mounted with `r.scope()` for this route's scopes, outer to inner. Recorded only: H2 #105 / A3 #121 run them. */
  readonly policies: ReadonlyArray<{ readonly dir: string; readonly policy: PolicyClass }>;
  /** Hostname set with `.domain()`, or `undefined` for any host. */
  readonly domain: string | undefined;
}
