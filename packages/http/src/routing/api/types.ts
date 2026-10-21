import type { API_NODE, AnyContract, AnyEndpoint, ApiEntry, ApiNodeInfo, ApiRoute } from "@laratype/contract";
import type Middleware from "../../middleware/Middleware";
import type { EndpointKey, VerifyController } from "./proof";

/**
 * Type side of `Route.api` (docs/v1/http.md › Router v2). It reads the API tree built by `defineApi`
 * (`typeof appApi`) and checks the mounted routes: every contract once, and a policy on every scope with `authorize`.
 */

/** A controller class, resolved with `app.make()`: its constructor params are injected (H2 #105). */
export type ControllerClass = new (...args: any[]) => object;

/** A policy class. Mounted policies are recorded on the registry; running them is A3 #121. */
export type PolicyClass = abstract new (...args: any[]) => object;

export type MiddlewareClass = typeof Middleware;

/** The `r` of an `endpoints` callback: `{ destroy: (r) => r.middleware(Audit) }`. Typed middleware is H6 #117. */
export interface EndpointRouteBuilder {
  middleware(...middleware: MiddlewareClass[]): EndpointRouteBuilder;
}

/** `r.contract(contract, Controller, { policy, endpoints })`. */
export type ContractRouteOptions<C, P extends PolicyClass | undefined = PolicyClass> = {
  /** Middleware for one endpoint, after the contract's: `{ destroy: (r) => r.middleware(Audit) }`. */
  readonly endpoints?: { readonly [K in EndpointKey<C>]?: (r: EndpointRouteBuilder) => EndpointRouteBuilder };
} & (
  // A required `policy` member, so `P` keeps the `undefined` of `cond ? Policy : undefined` (inference from an
  // optional property drops it) and the route proof reports the missing policy
  | {
      /**
       * The policy for the endpoints with `.authorize()`: it needs a method named after each of them, or `before`
       * (checked at `r.contract()` and, for its presence, when `Route.api` mounts). Recorded only: running it is A3 #121.
       */
      readonly policy: P;
    }
  | { readonly policy?: undefined }
);

/**
 * `r.contract(contract, Controller)`: every endpoint of the contract, bound to the controller method of the same key.
 * `contract` is the contract, or its tree node (`appApi.users.posts`).
 */
export interface MountedContract<C extends object = AnyContract> {
  readonly kind: "contract";
  readonly contract: C;
  readonly controller: ControllerClass;
  readonly middleware: readonly MiddlewareClass[];
  readonly options: ContractRouteOptions<C> | undefined;
}

/** `r.scope('<folder>', { policy })`: the policy for the `_scope.ts` of that folder. */
export interface MountedScope<D extends string = string> {
  readonly kind: "scope";
  readonly dir: D;
  readonly policy: PolicyClass;
  /** Runs before the middleware of every contract under the folder. */
  readonly middleware: readonly MiddlewareClass[];
}

export type ApiRouteItem = MountedContract<object> | MountedScope;

export interface ScopeRouteOptions {
  readonly policy: PolicyClass;
}

// ---- reading the API tree ---------------------------------------------------

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

type NodeEntry<N> = N extends { readonly [API_NODE]: ApiNodeInfo<infer Name, infer En> }
  ? En extends ApiEntry<infer C, infer Path, infer S, infer D> ? { name: Name; contract: C; path: Path; scopes: S; dirs: D; node: N } : never
  : never;

/** Every mounted contract of an API tree: `{ name, contract, scopes, dirs, node }`, one member per tree name. */
export type ApiTreeEntry<A> = { [K in keyof A & string]: A[K] extends AnyEndpoint ? never : NodeEntry<A[K]> | ApiTreeEntry<A[K]> }[keyof A & string];

/** Tree names of the contracts: `"users" | "users.posts"`. */
export type ApiTreeName<A> = ApiTreeEntry<A> extends infer E ? (E extends { name: infer N } ? N : never) : never;

/** The contracts of an API tree. */
export type ApiTreeContract<A> = ApiTreeEntry<A> extends infer E ? (E extends { contract: infer C } ? C : never) : never;

/** The tree nodes that hold a contract: `typeof appApi.users | typeof appApi.users.posts`. */
export type ApiTreeNode<A> = ApiTreeEntry<A> extends infer E ? (E extends { node: infer N } ? N : never) : never;

type ScopePairs<E> = E extends { scopes: infer S extends readonly unknown[]; dirs: infer D extends readonly string[] }
  ? { [I in keyof S]: { dir: D[I & keyof D]; authorize: S[I] extends { readonly authorize: true } ? true : false } }[number]
  : never;

/** The scope folders of an API tree: `"" | "users/[user]"`. */
export type ApiScopeDir<A> = ScopePairs<ApiTreeEntry<A>> extends infer P ? (P extends { dir: infer D } ? D : never) : never;

/** The scope folders whose `_scope.ts` has `authorize`: each needs `r.scope('<folder>', { policy })`. */
export type ApiAuthorizeDir<A> = ScopePairs<ApiTreeEntry<A>> extends infer P ? (P extends { dir: infer D; authorize: true } ? D : never) : never;

// ---- checking the mounted routes ----------------------------------------------

/** Tree names whose contract has exactly the type `C`. Two contracts with identical types share their names. */
type ContractNames<A, C> = ApiTreeEntry<A> extends infer E ? (E extends { name: infer N; contract: infer EC } ? (Equal<EC, C> extends true ? N : never) : never) : never;

/** The tree name of a mounted tree node (one name), or the names of a mounted contract's type (several for twins). */
type NamesOf<A, C> = C extends { readonly [API_NODE]: ApiNodeInfo<infer N, infer En> }
  ? En extends ApiEntry ? Extract<ApiTreeName<A>, N> : never
  : ContractNames<A, C>;

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

// Tail-recursive with an accumulator, stopping at 2 (all the checks need), so long route lists stay within
// TypeScript's tail-call limit instead of its much lower nesting limit
type ContractCount<A, M, Name, N extends 0[] = []> = N["length"] extends 2
  ? N
  : M extends readonly [infer H, ...infer R]
    ? ContractCount<A, R, Name, H extends MountedContract<infer HC> ? (Equal<NamesOf<A, HC>, Name> extends true ? [...N, 0] : N) : N>
    : N;

type DirCount<M, D, N extends 0[] = []> = N["length"] extends 2
  ? N
  : M extends readonly [infer H, ...infer R]
    ? DirCount<R, D, H extends MountedScope<infer HD> ? (Equal<HD, D> extends true ? [...N, 0] : N) : N>
    : N;

type Item<M extends readonly unknown[]> = M[number];

type Unknown<A, M extends readonly unknown[]> = Item<M> extends infer I ? (I extends MountedContract<infer C> ? ([NamesOf<A, C>] extends [never] ? true : never) : never) : never;

type MountedNames<A, M extends readonly unknown[]> = Item<M> extends infer I ? (I extends MountedContract<infer C> ? NamesOf<A, C> : never) : never;

type Missing<A, M extends readonly unknown[]> = Exclude<ApiTreeName<A>, MountedNames<A, M>>;

/** A contract whose type is the type of several tree contracts: the types can't tell them apart, its tree node can. */
type Ambiguous<A, M extends readonly unknown[]> = Item<M> extends infer I
  ? I extends MountedContract<infer C> ? (true extends IsUnion<NamesOf<A, C>> ? NamesOf<A, C> : never) : never
  : never;

/** A tree name mounted twice, by its contract or its tree node. */
type Twice<A, M extends readonly unknown[]> = Item<M> extends infer I
  ? I extends MountedContract<infer C>
    ? ContractCount<A, M, NamesOf<A, C>>["length"] extends 0 | 1 ? never : NamesOf<A, C>
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
    ? [Ambiguous<A, M>] extends [never]
      ? [Missing<A, M>] extends [never]
        ? [Twice<A, M>] extends [never]
          ? [NoPolicy<A, M>] extends [never]
            ? [ScopeTwice<M>] extends [never]
              ? unknown
              : Err<`scope "${ScopeTwice<M> & string}" is mounted twice`>
            : Err<`scope "${NoPolicy<A, M> & string}" has authorize but no policy (add r.scope() with { policy })`>
          : Err<`contract "${Twice<A, M> & string}" is mounted twice`>
        : Err<`contract "${Missing<A, M> & string}" is not mounted (add r.contract())`>
      : Err<`contract "${Ambiguous<A, M> & string}" has the type of another contract of the tree: mount it with its tree node, r.contract(appApi.<name>, ...)`>
    : Err<"a mounted contract is not in the API tree">;

/**
 * The route proof of `r.contract(contract, controller, options)` (docs/v1/http.md › Route proof at r.contract()), run
 * with the tree name and path of the mounted contract. A contract that names several tree contracts (twins) is
 * reported by `CheckApiRoutes`, so it is not proven here.
 */
export type RouteProof<A, C, I, O> = MountedEntry<ApiTreeEntry<A>, C> extends infer Hit
  ? [Hit] extends [never]
    ? unknown
    : IsUnion<Hit> extends true
      ? unknown
      : Hit extends { name: infer N extends string; contract: infer EC; path: infer P extends string }
        ? VerifyController<N, EC, P, I, {}, {}, O>
        : unknown
  : unknown;

/** The tree entry `r.contract()` mounts: by tree node, or by the exact type of its contract. */
type MountedEntry<En, C> = C extends { readonly [API_NODE]: ApiNodeInfo<infer Name, any> }
  ? Extract<En, { name: Name }>
  : En extends { contract: infer EC } ? (Equal<EC, C> extends true ? En : never) : never;

/** The `r` of `Route.api(appApi, (r) => [...])`. */
export interface ApiRouteBuilder<A> {
  /** Route middleware (0.5 classes) for the contracts or scope mounted from the returned builder. */
  middleware(...middleware: MiddlewareClass[]): ApiRouteBuilder<A>;
  /**
   * Mounts every endpoint of `contract` on the controller method of the same key. `contract` is the contract, or its
   * tree node (`appApi.users.posts`), which is needed when two contracts of the tree have the same type.
   */
  contract<C extends ApiTreeContract<A> | ApiTreeNode<A>, K extends ControllerClass, P extends PolicyClass | undefined = undefined>(
    contract: C,
    controller: K & RouteProof<A, C, InstanceType<K>, { readonly policy: NoInfer<P> }>,
    options?: ContractRouteOptions<NoInfer<C>, P>,
  ): MountedContract<C>;
  /** Mounts the policy for the `_scope.ts` of `dir` (root-relative, `""` for the root). */
  scope<D extends ApiScopeDir<A>>(dir: D, options: ScopeRouteOptions): MountedScope<D>;
}

/** One route registry entry: the contract route plus how it is served. Read by `sauf route:list`. */
export interface RouteEntry extends ApiRoute {
  /** The controller class and the method, named after the endpoint key. */
  readonly controller: readonly [ControllerClass, string];
  /** Scope middleware (outer to inner), then the contract's, then the endpoint's (`endpoints`). */
  readonly middleware: readonly MiddlewareClass[];
  /** Policies mounted with `r.scope()` for this route's scopes, outer to inner. Recorded only: A3 #121 runs them. */
  readonly policies: ReadonlyArray<{ readonly dir: string; readonly policy: PolicyClass }>;
  /** The `policy` of `r.contract()`, if any. Recorded only: A3 #121 runs it for endpoints with `.authorize()`. */
  readonly policy: PolicyClass | undefined;
  /** What the router does not enforce yet: resolved `auth` / `authorize` (#105, #121), `throttle` (#229), input schema validation (#106). */
  readonly unenforced: readonly UnenforcedCap[];
  /** Hostname set with `.domain()`, or `undefined` for any host. */
  readonly domain: string | undefined;
}

export type UnenforcedCap = "auth" | "authorize" | "throttle" | "validation";

/** What `RouteEntry.unenforced` means; printed by the mount warning. */
export const UNENFORCED_NOTICE = "auth, authorize, throttle and input schema validation are not enforced yet (planned → #105, #121, #229, #106)";
