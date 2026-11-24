import type { API_NODE, AnyContract, AnyEndpoint, ApiEntry, ApiNodeInfo, ApiRoute, EndpointTypes, EntryContext, PathParams, RootContext } from "@laratype/contract";
import type { Newable } from "@laratype/core";
import type { AnyInterceptor } from "../../interceptor/defineInterceptor";
import type { RegisteredModels } from "../../register";
import type Middleware from "../../middleware/Middleware";
import type { MiddlewareItem, TypedMiddleware } from "../../middleware/defineMiddleware";
import type Request from "../../supports/Request";
import type { Equal, Matches } from "./equal";
import type { EndpointInterceptorFit, InterceptorIssues } from "./interceptorProof";
import type { Bindings, Binder, EndpointKey, Merge, VerifyController } from "./proof";

/**
 * Type side of `Route.api` (docs/v1/http.md › Router v2). It reads the API tree built by `defineApi`
 * (`typeof appApi`) and checks the mounted routes: every contract once, and a policy on every scope with `authorize`.
 */

/** A controller class, resolved with `app.make()`: its constructor params are injected (H2 #105). */
export type ControllerClass = new (...args: any[]) => object;

/** A policy class. Mounted policies run for a route whose resolved `authorize` is true (H8 #122). */
export type PolicyClass = abstract new (...args: any[]) => object;

/** A middleware class: its constructor params are injected from the request's container (H21 #269). */
export type MiddlewareClass = Newable<Middleware>;

/**
 * The extensions of the middleware tuple `M`, merged in order as `applyExtensions()` merges them at runtime (H6 #117):
 * a later middleware's key replaces an earlier one's, and `params` is merged one level deep. The route proof checks
 * each handler against this merged shape, not an intersection, so a handler sees the value the runtime keeps.
 */
export type ExtOf<M extends readonly MiddlewareItem[]> = ExtOfTuple<M>;

type ExtOfTuple<M extends readonly MiddlewareItem[], X extends object = {}> = M extends readonly [
  infer H extends MiddlewareItem,
  ...infer R extends readonly MiddlewareItem[],
]
  ? ExtOfTuple<R, Merge<X, H extends TypedMiddleware<infer Ext extends object> ? Ext : {}>>
  : X;

/**
 * The middleware tuple `M` without every item of `W` (the same value, or a structurally identical one). Matched by type
 * identity, not assignability: a `TypedMiddleware<{ user: User }>` stays when `W` holds a `TypedMiddleware<{}>`, which
 * its type is also assignable to.
 */
type WithoutMiddleware<M extends readonly MiddlewareItem[], W extends readonly MiddlewareItem[]> = M extends readonly [
  infer H extends MiddlewareItem,
  ...infer R extends readonly MiddlewareItem[],
]
  ? true extends Matches<H, W[number]>
    ? WithoutMiddleware<R, W>
    : [H, ...WithoutMiddleware<R, W>]
  : [];

/**
 * The `r` of an `endpoints` callback: `{ destroy: (r) => r.middleware(Audit) }`. It starts empty: `withoutMiddleware`
 * removes only what the callback added (route middleware is removed on the builder, before `.contract()`). It takes 0.5
 * `Middleware` classes: a `defineMiddleware()` value extends the ctx of the handlers its route proves, and the
 * extensions of a callback cannot join that proof in the same call (docs/v1/http.md › Typed middleware). An
 * `interceptor()` here is checked against the callback's endpoint at the call site (H11 #138).
 */
export interface EndpointRouteBuilder<E extends AnyEndpoint = AnyEndpoint> {
  middleware(...middleware: MiddlewareClass[]): EndpointRouteBuilder<E>;
  withoutMiddleware(...middleware: MiddlewareClass[]): EndpointRouteBuilder<E>;
  /**
   * Interceptors for this one endpoint (H11 #138): the callback is checked before the options argument, so the check
   * covers the endpoint's response type, not the route's bindings or middleware extensions.
   */
  interceptor<const W extends readonly AnyInterceptor[]>(
    ...interceptors: W & EndpointInterceptorFit<E, W>
  ): EndpointRouteBuilder<E>;
}

/** The callback of one `endpoints` key. For an endpoint named after an `Object.prototype` member (`toString`), a map that
 * leaves it out still has the inherited member, which TypeScript compares with the callback type, so that member's type
 * is accepted too. A member with parameters (`hasOwnProperty`) widens to `Function` instead, which has no call signature,
 * so `r` keeps its contextual type. The runtime reads own keys only and rejects a callback that does not return the
 * builder.
 */
type EndpointCallback<C, K extends string> = K extends keyof Object
  ? ((r: EndpointRouteBuilder<EndpointOf<C, K>>) => EndpointRouteBuilder<EndpointOf<C, K>>) | (Object[K] extends () => unknown ? Object[K] : Function)
  : (r: EndpointRouteBuilder<EndpointOf<C, K>>) => EndpointRouteBuilder<EndpointOf<C, K>>;

/** The endpoint type of `key C[K]`, for the endpoint callback's typed interceptor check. */
type EndpointOf<C, K extends string> = K extends keyof C ? (C[K] extends AnyEndpoint ? C[K] : never) : never;

/** `r.contract(contract, Controller, { policy, endpoints })`. */
export type ContractRouteOptions<C, P extends PolicyClass | undefined = PolicyClass> = {
  /** Middleware for one endpoint, after the contract's: `{ destroy: (r) => r.middleware(Audit) }`. */
  readonly endpoints?: { readonly [K in EndpointKey<C>]?: EndpointCallback<C, K> };
} & (
  // A required `policy` member, so `P` keeps the `undefined` of `cond ? Policy : undefined` (inference from an
  // optional property drops it) and the route proof reports the missing policy
  | {
      /**
       * The policy for the endpoints with `.authorize()`: it needs a method named after each of them, or `before`
       * (checked at `r.contract()` and, for its presence, when `Route.api` mounts). It runs for every endpoint whose
       * resolved `authorize` is true (H8 #122).
       */
      readonly policy: P;
    }
  | { readonly policy?: undefined }
);

/**
 * `r.contract(contract, Controller)`: every endpoint of the contract, bound to the controller method of the same key.
 * `contract` is the contract, or its tree node (`appApi.users.posts`).
 */
export interface MountedContract<C extends object = AnyContract, B extends Record<string, Binder> = Bindings, Off extends boolean = false> {
  readonly kind: "contract";
  readonly contract: C;
  readonly controller: ControllerClass;
  readonly middleware: readonly MiddlewareItem[];
  /** The `r.interceptor()` values of the builder, in order: scope, contract, endpoint (H11 #138). */
  readonly interceptors: readonly AnyInterceptor[];
  /** The `r.bind()` bindings of the builder: resolved before the handler, later keys winning over a scope's. */
  readonly bindings: B;
  /** `false` for a builder that called `.withoutImplicitBinding()` (H14 #163): its contracts bind no registered model. */
  readonly implicitBinding?: boolean;
  /** `r.scopeBindings()` on the builder (H14 #163): a child model is looked up through its parent. */
  readonly scopedBindings?: boolean;
  readonly options: ContractRouteOptions<C> | undefined;
}

/** `r.scope('<folder>', { policy })`: the policy for the `_scope.ts` of that folder. */
export interface MountedScope<D extends string = string, B extends Record<string, Binder> = Bindings> {
  readonly kind: "scope";
  readonly dir: D;
  readonly policy: PolicyClass;
  /** Runs before the middleware of every contract under the folder. */
  readonly middleware: readonly MiddlewareItem[];
  /** The generic `r.interceptor()` values for every contract under the folder (H11 #138). */
  readonly interceptors: readonly AnyInterceptor[];
  /** The `r.bind()` bindings for the contracts under the folder (a contract's builder bindings win). */
  readonly bindings: B;
}

/** The methods of an ad-hoc route: `r.get()`, `r.post()`, `r.put()`, `r.patch()`, `r.delete()`. */
export type AdHocMethod = "get" | "post" | "put" | "patch" | "delete";

/**
 * `r.get('/health', () => 'ok')`: a route without a contract (docs/v1/http.md › Ad-hoc routes). Its params come from
 * the path and `R` from what the handler returns; it has no schema, so it is not in OpenAPI or the generated types.
 * `N` is the name `.name()` gave it, `undefined` until then (H13 #162): `route('health')` builds its URL.
 */
export interface MountedRoute<
  M extends AdHocMethod = AdHocMethod,
  P extends string = string,
  R = unknown,
  N extends string | undefined = undefined,
> {
  readonly kind: "route";
  readonly method: M;
  readonly path: P;
  /** Runs as a controller method does: the request, then the raw path params. */
  handler(req: Request, params: PathParams<P>): R | Promise<R>;
  readonly middleware: readonly MiddlewareItem[];
  /** The name `.name()` gave it, or `undefined`; the registry entry's `name` reads it. */
  readonly routeName: N;
  /**
   * Names the route for `route()` (H13 #162): a new frozen route with the name, never this one. The name is a
   * non-empty string, and only one route in the process may have it.
   */
  name<const Name extends string>(name: Name): MountedRoute<M, P, R, Name>;
}

/** An item of the routes callback: a mounted contract, a scope policy, or an ad-hoc route (named or not). */
export type ApiRouteItem = MountedContract<object> | MountedScope | MountedRoute<any, any, any, any>;

/** `r.get(path, handler)`, and the other methods: the path starts with `/` and is served as written. */
export type AdHocRouteMethod<M extends AdHocMethod> = <const P extends `/${string}`, R>(
  path: P,
  handler: (req: Request, params: PathParams<P>) => R | Promise<R>,
) => MountedRoute<M, P, R>;

export interface ScopeRouteOptions {
  readonly policy: PolicyClass;
}

// ---- reading the API tree ---------------------------------------------------

type NodeEntry<N> = N extends { readonly [API_NODE]: ApiNodeInfo<infer Name, infer En> }
  ? En extends ApiEntry<infer C, infer Path, infer S> ? { name: Name; contract: C; path: Path; scopes: S; node: N } : never
  : never;

/** Every mounted contract of an API tree: `{ name, contract, path, scopes, node }`, one member per tree name. */
export type ApiTreeEntry<A> = { [K in keyof A & string]: A[K] extends AnyEndpoint ? never : NodeEntry<A[K]> | ApiTreeEntry<A[K]> }[keyof A & string];

/** Tree names of the contracts: `"users" | "users.posts"`. */
export type ApiTreeName<A> = ApiTreeEntry<A> extends infer E ? (E extends { name: infer N } ? N : never) : never;

/** The contracts of an API tree. */
export type ApiTreeContract<A> = ApiTreeEntry<A> extends infer E ? (E extends { contract: infer C } ? C : never) : never;

/** The tree nodes that hold a contract: `typeof appApi.users | typeof appApi.users.posts`. */
export type ApiTreeNode<A> = ApiTreeEntry<A> extends infer E ? (E extends { node: infer N } ? N : never) : never;

type ScopePairs<E> = E extends { scopes: readonly (infer P)[] }
  ? P extends { readonly scope: infer S; readonly dir: infer D } ? { dir: D; authorize: S extends { readonly authorize: true } ? true : false } : never
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

/** The path params of every endpoint of contract `C` under `Path`, folder params included (the scope-binding check). */
type ParamKeys<C, Path extends string> = {
  [K in EndpointKey<C>]: C[K] extends AnyEndpoint ? keyof EndpointTypes<C[K], { path: Path; scopes: []; options: {} }>["params"] : never;
}[EndpointKey<C>];

/** A mounted scope's binding keys, from the route list's items. */
type ScopeBindingKeys<M extends readonly unknown[]> = Item<M> extends infer I
  ? I extends MountedScope<infer D, infer B> ? ([keyof B] extends [never] ? never : { dir: D; keys: keyof B & string }) : never
  : never;

/** The binding keys of the mounted contract of tree entry `N`. */
type MountedBindingKeys<A, M extends readonly unknown[], N> = Item<M> extends infer I
  ? I extends MountedContract<infer C, infer B, infer Off>
    ? Equal<NamesOf<A, C>, N> extends true ? keyof B & string : never
    : never
  : never;

/** Whether the mounted contract of tree entry `N` took its implicit bindings away (`.withoutImplicitBinding()`). */
type MountedImplicitOff<A, M extends readonly unknown[], N> = Item<M> extends infer I
  ? I extends MountedContract<infer C, any, infer Off>
    ? Equal<NamesOf<A, C>, N> extends true ? Off : never
    : never
  : never;

/**
 * The tree entries a scope `D` covers whose contract declares `K` but whose route does not provide it: no
 * `r.bind()` on the mounted contract, and no implicit binding for it (H14 #163: a registered model key the route
 * provides implicitly is no conflict, an opted-out contract still is).
 */
type UnboundEntries<A, M extends readonly unknown[], D extends string, K extends string> = ApiTreeEntry<A> extends infer E
  ? E extends { name: infer N extends string; contract: infer C; path: infer P extends string; scopes: readonly (infer S)[] }
    ? D extends (S extends { readonly dir: infer SD } ? SD : never)
      ? K extends ParamKeys<C, P>
        ? K extends MountedBindingKeys<A, M, N>
          ? never
          : [MountedImplicitOff<A, M, N>] extends [true]
            ? N
            : K extends keyof RegisteredModels ? never : N
        : never
      : never
    : never
  : never;

/**
 * A scope binding the handler proof cannot see (docs/v1/http.md › Model binding › Scopes): the proof runs per
 * `r.contract()` call with the mounting builder's bindings only, so a contract under the folder that does not bind `K`
 * itself would give the handler a model where its types say string.
 */
type ScopeBindingConflicts<A, M extends readonly unknown[]> = ScopeBindingKeys<M> extends infer S
  ? S extends { dir: infer D extends string; keys: infer K extends string }
    ? {
        [Key in K]: [UnboundEntries<A, M, D, Key>] extends [never]
          ? never
          : { error: `Route.api: scope "${D}" binds \`${Key}\`, but contract "${UnboundEntries<A, M, D, Key> & string}" is mounted from a builder that does not bind it: mount the contract from a builder that binds \`${Key}\` too (a handler's types see only its own builder's bindings)` };
      }[K]
    : never
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
              ? [ScopeBindingConflicts<A, M>] extends [never]
                ? unknown
                : ScopeBindingConflicts<A, M>
              : Err<`scope "${ScopeTwice<M> & string}" is mounted twice`>
            : Err<`scope "${NoPolicy<A, M> & string}" has authorize but no policy (add r.scope() with { policy })`>
          : Err<`contract "${Twice<A, M> & string}" is mounted twice`>
        : Err<`contract "${Missing<A, M> & string}" is not mounted (add r.contract())`>
      : Err<`contract "${Ambiguous<A, M> & string}" has the type of another contract of the tree: mount it with its tree node, r.contract(appApi.<name>, ...)`>
    : Err<"a mounted contract is not in the API tree">;

/**
 * The route proof of `r.contract(contract, controller, options)` (docs/v1/http.md › Route proof at r.contract()), run
 * with the tree name and path of the mounted contract, the middleware extensions `X` its builder accumulated
 * (H6 #117) and its `r.bind()` bindings `B` (H7 #118). A contract that names several tree contracts (twins) is reported
 * by `CheckApiRoutes`, so it is not proven here.
 */
export type RouteProof<A, C, I, O, X extends object = {}, B = {}, Off extends boolean = false> = MountedEntry<ApiTreeEntry<A>, C> extends infer Hit
  ? [Hit] extends [never]
    ? unknown
    : IsUnion<Hit> extends true
      ? unknown
      : Hit extends { name: infer N extends string; contract: infer EC; path: infer P extends string }
        ? VerifyController<N, EC, P, I, X, B, O, ProofContext<Hit>, Off>
        : unknown
  : unknown;

/** The scope values of a tree entry's `{ scope, dir }` chain, outer to inner. */
type ScopeValues<S extends readonly object[]> = {
  [I in keyof S]: S[I] extends { readonly scope: infer Sc } ? Sc : never;
};

/**
 * The endpoint context the route proof resolves auth in: the entry's path, its scope values (not the contract's
 * prefix, which does not know the folder it is mounted in) and its contract options.
 */
type ProofContext<Hit> = Hit extends { path: infer P extends string; scopes: infer S extends readonly object[] }
  ? { path: P; scopes: ScopeValues<S>; options: EntryContext<Hit>["options"] }
  : RootContext;

/**
 * The interceptor proof of `r.contract()` (H11 #138, docs/v1/http.md › Interceptors): resolves the mounted tree entry
 * as `RouteProof` does, then checks every concrete interceptor against every endpoint. Empty (unknown) without
 * interceptors; a generic interceptor is skipped (its result-parametric handler is the runtime backstop).
 */
type InterceptorProof<A, C, I extends readonly AnyInterceptor[], X extends object, B, Off extends boolean> = I extends readonly []
  ? unknown
  : MountedEntry<ApiTreeEntry<A>, C> extends infer Hit
    ? [Hit] extends [never]
      ? unknown
      : IsUnion<Hit> extends true
        ? unknown
        : Hit extends { name: infer N extends string; contract: infer EC; path: infer P extends string }
          ? InterceptorIssues<N, EC, P, I, X, B, Off>
          : unknown
    : unknown;

/** A scope takes generic interceptors only (H11 #138, amendment B): an endpoint-specific one is typed for one response. */
type EndpointSpecific<A> = A extends { readonly __kind: "endpoint" } ? A : never;

/**
 * The type-level half of amendment B. The check is compile-time only: a cast can bypass it, and the dev response check
 * is the runtime backstop (docs/v1/http.md › Interceptors).
 */
type ScopeInterceptorIssue<I extends readonly AnyInterceptor[], D extends string> = [
  EndpointSpecific<I[number]>,
] extends [never]
  ? unknown
  : { error: `Route.api: scope "${D}": interceptor is endpoint-specific; mount it on r.contract() or an endpoint` };

/** The tree entry `r.contract()` mounts: by tree node, or by the exact type of its contract. */
type MountedEntry<En, C> = C extends { readonly [API_NODE]: ApiNodeInfo<infer Name, any> }
  ? Extract<En, { name: Name }>
  : En extends { contract: infer EC } ? (Equal<EC, C> extends true ? En : never) : never;

/**
 * The bindings after a later `r.bind()`: a key it binds again is replaced, not intersected, since the runtime keeps the
 * later binding.
 */
type MergedBindings<B, NB> = Omit<B, keyof NB> & NB;

/**
 * A bind map's keys as the runtime sees them: an object key is a string, so `{ 123: User }` binds `"123"` and types the
 * `/:123` handler as `User` (H7 #118 follow-up). A symbol key is dropped, as the checked copy drops it.
 */
type NormalizedBindings<NB> = { [K in keyof NB as K extends string | number ? `${K}` : never]: NB[K] };

/**
 * The `r` of `Route.api(appApi, (r) => [...])`: its `M` is the middleware and `B` the bindings it accumulated; `I` is
 * the interceptor tuple (H11 #138), which the route proof and the scope check read; `Off` is
 * `.withoutImplicitBinding()` (H14 #163), which the proof reads for the contracts mounted from the builder.
 */
export interface ApiRouteBuilder<
  A,
  M extends readonly MiddlewareItem[] = [],
  B extends Record<string, Binder> = {},
  I extends readonly AnyInterceptor[] = [],
  Off extends boolean = false,
> {
  /** Middleware for the contracts or scope mounted from the returned builder: 0.5 classes or `defineMiddleware()`. */
  middleware<const W extends readonly MiddlewareItem[]>(...middleware: W): ApiRouteBuilder<A, [...M, ...W], B, I, Off>;
  /** Drops middleware the builder accumulated (the same value, or a structurally identical one): the opt-out. */
  withoutMiddleware<const W extends readonly MiddlewareItem[]>(...middleware: W): ApiRouteBuilder<A, WithoutMiddleware<M, W>, B, I, Off>;
  /**
   * Interceptors around the handlers of the contracts or scope mounted from the returned builder (H11 #138): the first
   * registered is outermost, and `next()` runs the rest of the chain once. A scope takes generic interceptors only.
   */
  interceptor<const W extends readonly AnyInterceptor[]>(...interceptors: W): ApiRouteBuilder<A, M, B, [...I, ...W], Off>;
  /**
   * Binds path params for the contracts or scope mounted from the returned builder (docs/v1/http.md › Model binding):
   * a model class (its instance) or a resolver from the raw param. A key is checked against every path param of the
   * contract at `r.contract()`; a later call wins a key it binds again.
   */
  bind<const NB extends Record<string, Binder>>(bindings: NB): ApiRouteBuilder<A, M, MergedBindings<B, NormalizedBindings<NB>>, I, Off>;
  /**
   * The contracts mounted from the returned builder bind no registered model (H14 #163): a path param that
   * `Register['models']` names stays a string. Explicit `.bind()` still binds its keys.
   */
  withoutImplicitBinding(): ApiRouteBuilder<A, M, B, I, true>;
  /**
   * The contracts mounted from the returned builder resolve each child model through its parent (H14 #163): a
   * `/users/:user/posts/:post` route's `post` is looked up with `{ user }` as its scope, and a child of another parent
   * is the 404.
   */
  scopeBindings(): ApiRouteBuilder<A, M, B, I, Off>;
  /**
   * Mounts every endpoint of `contract` on the controller method of the same key. `contract` is the contract, or its
   * tree node (`appApi.users.posts`), which is needed when two contracts of the tree have the same type.
   */
  contract<C extends ApiTreeContract<A> | ApiTreeNode<A>, K extends ControllerClass, P extends PolicyClass | undefined = undefined>(
    contract: C,
    controller: K & RouteProof<A, C, InstanceType<K>, { readonly policy: NoInfer<P> }, ExtOf<M>, B, Off> & InterceptorProof<A, C, I, ExtOf<M>, B, Off>,
    options?: ContractRouteOptions<NoInfer<C>, P>,
  ): MountedContract<C, B, Off>;
  /** Mounts the policy for the `_scope.ts` of `dir` (root-relative, `""` for the root). A scope takes generic interceptors only. */
  scope<D extends ApiScopeDir<A>>(
    dir: D & ScopeInterceptorIssue<I, D>,
    options: ScopeRouteOptions,
  ): MountedScope<D, B>;
  /** An ad-hoc route, without a contract: `r.get('/health', () => 'ok')`. Not with interceptors (they need an endpoint). */
  get: I extends readonly [] ? AdHocRouteMethod<"get"> : never;
  post: I extends readonly [] ? AdHocRouteMethod<"post"> : never;
  put: I extends readonly [] ? AdHocRouteMethod<"put"> : never;
  patch: I extends readonly [] ? AdHocRouteMethod<"patch"> : never;
  delete: I extends readonly [] ? AdHocRouteMethod<"delete"> : never;
}

/** One route registry entry: the contract route plus how it is served. Read by `sauf route:list`. */
export interface RouteEntry extends ApiRoute {
  /** The controller class and the method, named after the endpoint key. */
  readonly controller: readonly [ControllerClass, string];
  /** Scope middleware (outer to inner), then the contract's, then the endpoint's (`endpoints`). */
  readonly middleware: readonly MiddlewareItem[];
  /** Scope interceptors (outer to inner), then the contract's, then the endpoint's, deduplicated (H11 #138). */
  readonly interceptors: readonly AnyInterceptor[];
  /** Policies mounted with `r.scope()` for this route's scopes, outer to inner. Run when the route's resolved `authorize` is true. */
  readonly policies: ReadonlyArray<{ readonly dir: string; readonly policy: PolicyClass }>;
  /** The `policy` of `r.contract()`, if any. Run last when the route's resolved `authorize` is true. */
  readonly policy: PolicyClass | undefined;
  /** The `r.bind()` binders of this route, its scopes' then its contract's and its path params only: `resolveRouteBindings()` runs them per request. */
  readonly bindings: Bindings;
  /** The path params the app's registered models bind implicitly, in path order (H14 #163); empty on an opted-out contract. */
  readonly implicitBindings: readonly string[];
  /** `false` for a `.withoutImplicitBinding()` contract (H14 #163). */
  readonly implicitBinding: boolean;
  /** `r.scopeBindings()` on the contract's builder (H14 #163): each child model is looked up through its parent. */
  readonly scopedBindings: boolean;
  /** What the router does not enforce yet: headers schema validation. */
  readonly unenforced: readonly UnenforcedCap[];
  /** Hostname set with `.domain()`, or `undefined` for any host. */
  readonly domain: string | undefined;
}

/** The registry entry of an ad-hoc route. It has no contract or controller; `.name()` gives it a name (H13 #162). */
export interface AdHocRouteEntry {
  readonly method: AdHocMethod;
  readonly path: string;
  readonly name: string | undefined;
  readonly controller: undefined;
  readonly handler: MountedRoute["handler"];
  readonly middleware: readonly MiddlewareItem[];
  readonly domain: string | undefined;
}

export type UnenforcedCap = "validation";

/** What `RouteEntry.unenforced` means; printed by the mount warning. */
export const UNENFORCED_NOTICE = "headers schema validation is not enforced yet";
