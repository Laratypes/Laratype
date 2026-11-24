import type { AnyEndpoint, EndpointContext, EndpointTypes, GuardUser, InferIn, InferOut, PathParams, ResolvedAuth, ResolvedAuthorize, RootContext } from "@laratype/contract";
import type ResponseSupport from "../../supports/Response";
import type JsonResource from "../../resource/json/JsonResource";
import type RequestSupport from "../../supports/Request";
import type Controller from "../../controller/Controller";
import type { RegisteredModels } from "../../register";
import type { Matches } from "./equal";

/**
 * Controller typing (docs/v1/http.md › Controller typing: Ctx and ControllerOf) and the route proof that
 * `r.contract()` runs on it (› Route proof at r.contract()).
 *
 * Both sides share `BaseCtx`, what the runtime builds for a contract route (H3 #106): the endpoint, the raw path
 * params and the validated query and body.
 */

type T<E extends AnyEndpoint> = E["__types"];
type MaybePromise<X> = X | Promise<X>;
type Flat<O> = { [K in keyof O]: O[K] } & {};

/**
 * What the runtime passes to the handler of endpoint `E` with path params `P`: the endpoint (read-only), the path
 * params as raw strings, and the query and body as the output of their schemas (`undefined` without one).
 */
export type BaseCtx<E extends AnyEndpoint, P = PathParams<T<E>["path"]>> = {
  readonly endpoint: E;
  params: P;
  query: InferOut<T<E>["query"]>;
  body: InferOut<T<E>["body"]>;
};

/**
 * `Base` with `Extra` on top, as `applyExtensions()` merges an extension into the ctx at runtime: a key of `Extra`
 * replaces the same key of `Base`, and `params` is merged one level deep (a bound param replaces its string). Shared by
 * `Ctx` and `Provided`, and by `ExtOf`, which merges a route's middleware extensions in order with the same rule
 * (H6 #117).
 */
export type Merge<Base, Extra> = Flat<
  Omit<Base, keyof Extra> &
    Omit<Extra, "params"> &
    ("params" extends keyof Extra ? { params: Flat<Omit<Sub<Base, "params">, keyof Extra["params"]> & Extra["params"]> } : {})
>;

/**
 * A handler's context: `BaseCtx` plus what the handler requires from the route (middleware extensions and
 * `.bind()`-resolved params). `Ctx` knows the endpoint's own path params; a folder param (`user` of
 * `users/[user]/posts`) is listed in `Requires`.
 *
 * The app's registered models (`Register['models']`, H14 #163) replace the string of an endpoint's own path param, so
 * `Ctx<typeof users.show>` has `params.user: User` without a `Requires` entry or a `r.bind()`.
 *
 *   async index({ query }: Ctx<typeof posts.index>)
 *   async destroy({ params }: Ctx<typeof posts.destroy, { params: { post: Post } }>)
 */
export type Ctx<E extends AnyEndpoint, Requires extends object = {}> = Merge<Merge<BaseCtx<E>, ImplicitParams<E>>, Requires>;

/** What a handler returns: the response schema input (the serializer runs afterwards), or nothing without one. */
export type Result<E extends AnyEndpoint> = T<E>["response"] extends undefined ? void : InferIn<T<E>["response"]>;

/**
 * What the runtime also takes from a handler, unchecked against the schema: a `response()` / `redirect()` value, whose
 * own status still wins, and a 0.5 `JsonResource`. A v2 resource (H9 #123) returns plain data, which the check covers.
 */
export type ResponseEscape = ResponseSupport | JsonResource;

/** The endpoint keys of a contract or of its tree node (a node also holds its child nodes). */
export type EndpointKey<C> = { [K in keyof C & string]: C[K] extends AnyEndpoint ? K : never }[keyof C & string];

/**
 * Optional: `class PostController implements ControllerOf<typeof posts>` reports a missing handler or a wrong return
 * type at the method. Requirements are checked at `r.contract()` only (`implements` doesn't type params, TS #23911).
 */
export type ControllerOf<C> = {
  [K in EndpointKey<C>]: C[K] extends AnyEndpoint ? (ctx: any) => MaybePromise<Result<C[K]> | ResponseEscape> : never;
};

// ---- what the route provides ------------------------------------------------

/**
 * A resolver from the raw param. A value carrying `findByRouteKey` is a model at runtime (`isModelClass`), so a resolver
 * must not carry it: `Binder` refuses one, as `checkBinder` refuses a model without a string `primaryKey` (H7 #118).
 */
type Resolver = ((value: string) => unknown) & { readonly findByRouteKey?: never };

/**
 * The static side of a model class `r.bind()` takes (docs/v1/database.md › BindableModel), structural and type-only:
 * `@laratype/http` does not import `@laratype/database`. `findByRouteKey` returns `null` / `undefined` on a miss, which
 * is the contract's derived 404; `routeKeyName` defaults to `primaryKey`. The optional `scope` holds the models bound
 * for the route's earlier path params, for a `.scopeBindings()` route (H14 #163).
 */
export interface BindableModelClass<M extends object = object> {
  new (...args: any[]): M;
  readonly primaryKey: string;
  readonly routeKeyName?: string;
  findByRouteKey(key: string, scope?: Readonly<Record<string, object>>): Promise<M | null | undefined>;
}

/** A `.bind()` value: a model class, a callable carrying its statics, or a resolver from the raw param (H7 #118). */
export type Binder = BindableModelClass | CallableModel | Resolver;

/** A `.bind()` map: one value per path param key. */
export type Bindings = Readonly<Record<string, Binder>>;

/**
 * The statics `isModelClass` reads at runtime: a callable that has them (and no construct signature) is a model, not a
 * resolver, so its value is the lookup result. `BindableModelClass` is the constructable form of the same shape.
 */
type ModelStatics = { readonly primaryKey: string; findByRouteKey(key: string, scope?: Readonly<Record<string, object>>): unknown };

/** A callable that carries the model statics without a construct signature: a model at runtime (`isModelClass`). */
type CallableModel = ((value: string) => unknown) & ModelStatics;

/**
 * The value a binder gives the handler. A `BindableModelClass` gives its instance (the class's own type: its
 * `findByRouteKey` builds the receiver, so a subclass overrides an inherited base-returning lookup); a callable that
 * carries the same statics is a model too at runtime (`isModelClass`), so it gives its lookup result; any other resolver
 * is called, and its miss is a 404, so the handler sees the value without `null` / `undefined`. Constructability alone is
 * not enough: `Date` is newable and callable, and the runtime calls it as a resolver.
 */
type Bound<B> = B extends BindableModelClass
  ? InstanceType<B>
  : B extends ModelStatics
    ? NonNullable<Awaited<ReturnType<B["findByRouteKey"]>>>
    : B extends Resolver
      ? NonNullable<Awaited<ReturnType<B>>>
      : never;

/** The bound params of endpoint params `P`: an optional param (`:post?`) is `undefined` when the request has none. */
type BoundParams<P, B> = {
  [K in keyof B & keyof P]: Bound<B[K]> | (undefined extends P[K] ? undefined : never);
};

/** Every path param of endpoint `E` mounted under `Path`, the tree path of its contract, as the client sees them. */
type FullParams<E extends AnyEndpoint, Path extends string> = EndpointTypes<E, { path: Path; scopes: []; options: {} }>["params"];

/**
 * @internal The app's registered models under the params `P` (docs/v1/http.md › Model binding, H14 #163): the value is
 * the model **class**, so `Bound` gives its instance exactly as a `.bind({ user: User })` binder does. `Register['models']`
 * is `{}` before the generated augmentation, and `keyof {}` is `never`, so the map is empty then.
 */
type ImplicitKeys<P> = { [K in keyof P & keyof RegisteredModels]: RegisteredModels[K] };

/**
 * @internal The bindings under an explicit `.bind()` map: a key both sides name keeps the explicit binder (the runtime
 * resolves the explicit entry last), and a `.withoutImplicitBinding()` builder (`Off`) has none.
 */
type WithImplicit<P, B, Off extends boolean> = Off extends true ? B : Omit<ImplicitKeys<P>, keyof B> & B;

/**
 * @internal What the endpoint's own path params contribute to `Ctx<E>`: a registered model replaces its string. A tree
 * folder param is not in the endpoint's path, so it stays listed in `Requires`.
 */
type ImplicitParams<E extends AnyEndpoint> = keyof RegisteredModels extends never
  ? {}
  : { params: BoundParams<PathParams<T<E>["path"]>, ImplicitKeys<PathParams<T<E>["path"]>>> };

type IsOn<V> = [V] extends [undefined | false] ? false : true;

/**
 * What the endpoint's resolved `auth` adds to the handler ctx (A2 #120): the guard's user, under `user`. Nothing on
 * a public route. Route middleware extensions are merged after it, so a middleware's `user` type wins, as it wins the
 * value at runtime.
 */
type AuthExtension<E extends AnyEndpoint, Ctx extends EndpointContext> =
  IsOn<ResolvedAuth<E, Ctx>> extends true ? { user: GuardUser<ResolvedAuth<E, Ctx>> } : {};

/** The middleware extensions with the bound params in place of their strings: a binding wins a param key both add. */
type WithBindings<X extends object, P, B> = Merge<X, { params: BoundParams<P, B> }>;

/**
 * What the route passes to the handler of endpoint `E` under `Path`: `BaseCtx` with every path param of the full
 * path (folder params included), the `auth` capability's user, the middleware extensions `X` and the bound params
 * `B` in place of their strings. `Off` is the builder's `.withoutImplicitBinding()`: its routes bind no registered
 * model.
 */
export type Provided<
  E extends AnyEndpoint,
  Path extends string,
  X extends object = {},
  B = {},
  Ctx extends EndpointContext = RootContext,
  Off extends boolean = false,
> = Merge<Merge<BaseCtx<E, FullParams<E, Path>>, AuthExtension<E, Ctx>>, WithBindings<X, FullParams<E, Path>, WithImplicit<FullParams<E, Path>, B, Off>>>;

// ---- the check --------------------------------------------------------------

type RequiredKeys<O> = { [K in keyof O]-?: {} extends Pick<O, K> ? never : K }[keyof O];
type Missing<Pv, Rq> = Exclude<RequiredKeys<Rq>, keyof Pv> & string;
type Mismatched<Pv, Rq> = { [K in keyof Rq & keyof Pv]-?: [Pv[K]] extends [Rq[K]] ? never : K }[keyof Rq & keyof Pv] & string;
type Sub<O, K extends string> = K extends keyof O ? O[K] : {};
type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/**
 * The paths of `O` whose type is `never`: a key a middleware declares `never` (H6 #117) has no value to give the ctx,
 * while a handler could read it as whatever it declares (`never` is assignable to every type, so the requirement check
 * would pass). `ExtOf` merges the extensions last-wins, so a `never` no longer comes from two extensions intersecting;
 * this walk still catches a declared `never`, nested ones included. A key typed only `undefined` is not a conflict, and
 * `undefined` is dropped before the walk of an optional key. Nested objects are walked (a key is named by its path,
 * `user.id`), arrays and functions are not walked or compared. A self-referencing extension type is walked once per
 * path: `Matches` stops the walk at a type it already saw there, so a recursive type does not hit TypeScript's
 * instantiation limit.
 */
type NeverKeys<O, Seen = never> = {
  [K in keyof O & string]-?: [O[K]] extends [never]
    ? K
    : [Exclude<O[K], undefined>] extends [never]
      ? never
      : Exclude<O[K], undefined> extends readonly unknown[] | ((...args: any[]) => unknown)
        ? never
        : Exclude<O[K], undefined> extends object
          ? true extends Matches<Exclude<O[K], undefined>, Seen>
            ? never
            : `${K}.${NeverKeys<Exclude<O[K], undefined>, Seen | Exclude<O[K], undefined>>}`
          : never;
}[keyof O & string];

/** The path and the diagnosis of a key a middleware declares `never`. */
type ConflictLabel<N extends string, K extends string> =
  `${N}: middleware extension '${K}' is \`never\` (declared \`never\`)`;

/**
 * A `never` extension: the proof refuses the key, whatever the handler declares. The runtime cannot provide it, and the
 * handler could read it as any type.
 */
type ConflictIssues<N extends string, X> = {
  [K in NeverKeys<X> as ConflictLabel<N, K>]: { conflicting_key: K };
};

/** The extension keys a contract route keeps for itself: the validated `query` and `body`, and the pinned `endpoint`. */
type ReservedKey = "query" | "body" | "endpoint";

/**
 * A middleware extension that names a key a contract route keeps: at runtime the extension is refused before the
 * handler, so the proof reports it whatever the handler declares (a handler typed `any` included).
 */
type ReservedIssues<N extends string, X> = {
  [K in Extract<keyof X, ReservedKey> as `${N}: middleware extension '${K}' is reserved on a contract route (the validated query and body, and the endpoint)`]: K;
};

/** Keys the handler needs that the route doesn't provide: `user`, `params.user`. */
type MissingKeys<Pv, Rq> = Missing<Pv, Rq> | `params.${Missing<Sub<Pv, "params">, Sub<Rq, "params">>}`;

/** Keys both sides have, where the provided type doesn't satisfy the required one (`params` is compared per key). */
type MismatchedKeys<Pv, Rq> =
  | Exclude<Mismatched<Pv, Rq>, "params">
  | `params.${Mismatched<Sub<Pv, "params">, Sub<Rq, "params">>}`;

type At<O, P extends string> = P extends `params.${infer K}` ? Sub<Sub<O, "params">, K> : Sub<O, P>;

/** A member of the 0.5 request that the ctx doesn't have. */
type RequestKey = Exclude<keyof RequestSupport, keyof BaseCtx<AnyEndpoint>> & string;

/** A missing key; one of the 0.5 request when the handler is typed with that object (it has `rules()`). */
type MissingLabel<N extends string, M extends string, Rq> = M extends RequestKey
  ? Rq extends { rules(): unknown }
    ? `${N}: handler takes the 0.5 request (\`${M}\`), Route.api passes the ctx { endpoint, params, query, body }`
    : `${N}: handler requires \`${M}\`, route does not provide it (add middleware / .bind())`
  : `${N}: handler requires \`${M}\`, route does not provide it (add middleware / .bind())`;

/*
 * Readable errors: the diagnosis is in the PROPERTY NAMES of the error type, since tsc prints the names of missing
 * properties in full but truncates property types to `{ ...; }`. The values hold the details.
 */
/**
 * The requirement check's diagnosis, one per key. `user` has its own messages (A2 #120): on a route without auth the
 * handler asks for a user the framework never resolves, and on an auth route a different type is the guard's user
 * type. A middleware that adds `user` keeps the generic messages, since its type is the value the runtime keeps.
 */
type RequirementIssues<N extends string, Pv, Rq, AuthOn extends boolean, X extends object> = {
  [M in MissingKeys<Pv, Rq> as M extends "user"
    ? AuthOn extends true
      ? MissingLabel<N, M, Rq>
      : `${N}: handler requires \`user\`, route has no auth (add auth: true or a guard to the endpoint, its contract or a scope)`
    : MissingLabel<N, M, Rq>]: {
    handler_requires: At<Rq, M>;
  };
} & {
  [M in MismatchedKeys<Pv, Rq> as M extends "endpoint"
    ? `${N}: handler ctx is typed for a different endpoint`
    : M extends "query" | "body"
      ? `${N}: \`${M}\` of the ctx does not match the handler (it is the output of the endpoint's ${M} schema)`
      : M extends "user"
        ? AuthOn extends true
          ? "user" extends keyof X
            ? `${N}: \`user\` provided by the route does not match the handler (missing .bind()?)`
            : `${N}: \`user\` of the ctx does not match the guard's user type (the auth capability's guard)`
          : `${N}: \`user\` provided by the route does not match the handler (missing .bind()?)`
        : `${N}: \`${M}\` provided by the route does not match the handler (missing .bind()?)`]: {
    route_provides: At<Pv, M>;
    handler_requires: At<Rq, M>;
  };
};

/** The detail of a return type mismatch. */
export interface ReturnMismatch<Expected, Got> {
  expected: Expected;
  got: Got;
}

type IsAny<X> = 0 extends 1 & X ? true : false;

/** A requirement that no single key explains (a private member, a call signature): the handler can't take the ctx. */
type Unexplained<N extends string, Pv, Rq, Issues> = keyof Issues extends never
  ? { [_ in `${N}: handler ctx does not accept what the route provides`]: { route_provides: Pv; handler_requires: Rq } }
  : Issues;

/**
 * The runtime passes the raw path params (strings) as the second argument: a handler that types it as bound models
 * would read strings.
 */
type SecondIssues<N extends string, Rest extends unknown[], Raw> = Rest["length"] extends 0
  ? {}
  : [Raw] extends [Rest[0]]
    ? {}
    : { [_ in `${N}: the second parameter gets the raw path params (strings), use .bind() and ctx`]: { route_provides: Raw; handler_requires: Rest[0] } };

/** An endpoint without a response schema answers no body: `return;` or `return null` (the runtime sends nothing for both). */
type NoBody<E extends AnyEndpoint> = T<E>["response"] extends undefined ? null : never;

/**
 * Conditional types, not function assignability: methods compare bivariantly, so `{ show(ctx: Provided): any }`
 * would accept a handler that needs more than the route provides. `[Provided] extends [Param]` is one-directional.
 * Any callable property counts as a handler (class methods, and an `action()` property later); an `any` one passes.
 * A key a middleware declared `never` is reported before the parameter check, since the handler would otherwise be
 * proven against a value the runtime never produces.
 */
type HandlerIssues<N extends string, E extends AnyEndpoint, H, Pv, Raw, X extends object, AuthOn extends boolean> = IsAny<H> extends true
  ? {}
  : keyof ConflictIssues<N, X> extends never
    ? H extends (ctx: infer Rq, ...rest: infer Rest) => infer R
      ? [Pv] extends [Rq]
        ? [Awaited<R>] extends [Result<E> | NoBody<E> | ResponseEscape]
          ? SecondIssues<N, Rest, Raw>
          : { [_ in `${N}: return type does not match the response schema`]: ReturnMismatch<Result<E>, Awaited<R>> }
        : Unexplained<N, Pv, Rq, Flat<RequirementIssues<N, Pv, Rq, AuthOn, X>>>
      : { [_ in `${N}: controller has no handler for this endpoint`]: H }
    : ConflictIssues<N, X>;

/** The handler for key `K`: a member of the controller, never one of the base `Controller` (the runtime rejects those). */
type HandlerOf<I, K> = K extends Exclude<keyof I, keyof Controller> ? I[K] : undefined;

type ControllerIssues<N extends string, C, Path extends string, I, X extends object, B, Ctx extends EndpointContext, Off extends boolean> = UnionToIntersection<
  {
    [K in EndpointKey<C>]: C[K] extends infer E extends AnyEndpoint
      ? HandlerIssues<
          `${N}.${K}`,
          E,
          HandlerOf<I, K>,
          Provided<E, Path, X, B, Ctx, Off>,
          { [P in keyof FullParams<E, Path>]: string },
          X,
          IsOn<ResolvedAuth<E, Ctx>>
        > &
        ReservedIssues<`${N}.${K}`, X>
      : {};
  }[EndpointKey<C>]
>;

type AllPathParams<C, Path extends string> = {
  [K in EndpointKey<C>]: C[K] extends infer E extends AnyEndpoint ? keyof FullParams<E, Path> : never;
}[EndpointKey<C>];

type BindIssues<N extends string, C, Path extends string, B> = {
  [K in Exclude<keyof B, AllPathParams<C, Path>> & string as `.bind(): \`${K}\` is not a path param of any endpoint in ${N}`]: B[K];
};

/** Endpoint keys with their own `.authorize()` (or `.authorize(flag)`): each needs the contract's policy. */
type OwnAuthorizedKeys<C> = {
  [K in EndpointKey<C>]: C[K] extends { readonly __types: { caps: { authorize: infer F } } } ? (true extends F ? K : never) : never;
}[EndpointKey<C>];

/** Endpoint keys whose `authorize` may resolve true: an own `.authorize(true)` or boolean flag, an own `.authorize(false)` never, otherwise the inherited scope `authorize`. */
type ResolvedAuthorizedKeys<C, Ctx extends EndpointContext> = {
  [K in EndpointKey<C>]: C[K] extends infer E extends AnyEndpoint
    ? E["__types"]["caps"]["authorize"] extends false
      ? never
      : true extends E["__types"]["caps"]["authorize"]
        ? K
        : ResolvedAuthorize<E, Ctx> extends true
          ? K
          : never
    : never;
}[EndpointKey<C>];

/** The method names of a policy instance: a property that is not a function doesn't count. */
type MethodKeys<P> = { [K in keyof P]-?: P[K] extends (...args: any) => any ? K : never }[keyof P];

/** The method names that can be abilities: `before` is the hook, never an ability. */
type AbilityKeys<P> = Exclude<MethodKeys<P>, "before">;

/** The parameters of a policy method after the user: `update(user, post)` gives `[post: Post]`, `viewAny(user)` gives `[]`. */
type MethodRest<P, K> = K extends keyof P ? (P[K] extends (user: any, ...args: infer A) => any ? A : never) : never;

/**
 * The param name of one path segment, or `""` for a static, wildcard or empty segment (the runtime's
 * `pathParamNames`). The regex form is read before the optional `?`: the trailing `?` of `:id{re}?` is not part of
 * the name, while a `?` inside the regex (`:id{[a-z]?}`) is not the optional marker. Each form the runtime accepts
 * (`:id`, `:id?`, `:id{re}`, `:id{re}?`, a regex holding `?` or `}`) gives the same name here.
 */
type SegmentParam<S extends string> = S extends `:${infer Rest}`
  ? Rest extends `${infer N}{${string}}${string}`
    ? N
    : Rest extends `${infer N}{${string}`
      ? N
      : Rest extends `${infer N}?`
        ? N
        : Rest
  : "";

type SegmentParams<S extends string> = SegmentParam<S> extends infer N extends string ? (N extends "" ? [] : [N]) : [];

/** The param names of a path, in path order: the endpoint's own models are passed in this order (H8 #122). */
type PathParamsInOrder<P extends string> = P extends `${infer Head}/${infer Tail}`
  ? Head extends `${string}{${string}`
    ? Head extends `${string}}${string}`
      ? [...SegmentParams<Head>, ...PathParamsInOrder<Tail>]
      : PathParamsInOrder<`${Head}\u0000${Tail}`>
    : [...SegmentParams<Head>, ...PathParamsInOrder<Tail>]
  : SegmentParams<P>;

/** The names without repetitions, as Hono's params object has one key per name. */
type UniqueParams<T extends readonly string[], Seen extends string = never> = T extends readonly [
  infer H extends string,
  ...infer R extends readonly string[],
]
  ? H extends Seen
    ? UniqueParams<R, Seen>
    : [H, ...UniqueParams<R, Seen | H>]
  : [];

/** The type of one path param: an optional one (`:post?`) may be absent. */
type ParamValue<P extends string, K extends string> = K extends keyof PathParams<P> ? PathParams<P>[K] : string;

/** The endpoint's own path param names, in path order: the keys the endpoint policy's arguments come from. */
type EndpointBoundNames<E extends AnyEndpoint> = UniqueParams<PathParamsInOrder<T<E>["path"]>>;

/**
 * The models the endpoint policy receives: the endpoint's own path params that the route binds (explicitly or from the
 * app's registered models), in path order. A param the route does not bind is `undefined` at runtime (the scope hook,
 * not the endpoint policy, reads folder models).
 */
type EndpointBoundModels<E extends AnyEndpoint, B, Off extends boolean> = EndpointBoundNames<E> extends infer Names extends readonly string[]
  ? {
      [I in keyof Names]: Names[I] extends infer K extends string
        ? K extends keyof WithImplicit<PathParams<T<E>["path"]>, B, Off>
          ? Bound<WithImplicit<PathParams<T<E>["path"]>, B, Off>[K]> | (undefined extends ParamValue<T<E>["path"], K> ? undefined : never)
          : undefined
        : never;
    }
  : never;

/** The names of a bound-model tuple in a diagnostic: `(post, comment)`, or `(none)`. */
type JoinBoundNames<T extends readonly string[]> = T extends readonly [infer H extends string, ...infer R extends readonly string[]]
  ? R extends readonly [] ? H : `${H}, ${JoinBoundNames<R>}`
  : "none";

/**
 * Whether the method accepts the bound tuple: it must be callable with the user and those models. A method that
 * declares fewer parameters stays valid (JavaScript ignores the extra models), an optional parameter accepts a missing
 * model, and a rest parameter accepts every tuple.
 */
type MethodAccepts<Provided extends readonly unknown[], F> = F extends (user: any, ...args: [...Provided]) => any ? true : false;

/**
 * The endpoint policy's arguments against the route's bound models (H8 #122): a method that needs a model the route
 * does not bind, or a different model type, is reported. Extra bound models a method ignores are fine.
 */
type PolicyArgumentIssues<N extends string, C, Ctx extends EndpointContext, P, B, Off extends boolean> = {
  [K in Extract<ResolvedAuthorizedKeys<C, Ctx>, AbilityKeys<P>> as C[K] extends infer E extends AnyEndpoint
    ? MethodAccepts<EndpointBoundModels<E, B, Off>, P[K]> extends true
      ? never
      : `${N}.${K}: the policy's \`${K}\` method does not accept the bound models the route passes (${JoinBoundNames<EndpointBoundNames<E>>})`
    : never]: C[K] extends infer E extends AnyEndpoint
    ? { route_provides: EndpointBoundModels<E, B, Off>; policy_accepts: MethodRest<P, K> }
    : never;
};

/** Exactly `object`: the instance of a class known only as a `PolicyClass` (an empty class gives `{}`). */
type IsObject<X> = (<V>() => V extends X ? 1 : 2) extends (<V>() => V extends object ? 1 : 2) ? true : false;

/**
 * The policy instance; `undefined` without one, or when a specific class may be `undefined` (`cond ? Policy : undefined`);
 * `unknown`, unchecked, when it is `any` or only known as a `PolicyClass` (options typed `ContractRouteOptions<C>`).
 */
type PolicyOf<O> = O extends { readonly policy: infer P }
  ? IsAny<P> extends true
    ? unknown
    : IsWidePolicy<NonNullable<P>> extends true
      ? unknown
      : undefined extends P
        ? undefined
        : P extends abstract new (...args: any) => any
          ? InstanceType<P>
          : undefined
  : undefined;

/** A class known only as a `PolicyClass` (its instance is exactly `object`), with or without `| undefined`. */
type IsWidePolicy<PC> = [PC] extends [never]
  ? false
  : [PC] extends [abstract new (...args: any) => any]
    ? IsObject<InstanceType<PC>>
    : false;

type PolicyIssues<N extends string, C, O, Ctx extends EndpointContext, B, Off extends boolean> = PolicyOf<O> extends infer P
  ? [unknown] extends [P]
    ? {}
    : [P] extends [undefined]
    ? { [K in OwnAuthorizedKeys<C> as `${N}.${K}: endpoint has .authorize() but r.contract() has no { policy }`]: K }
    : "before" extends MethodKeys<P>
      ? [AbilityKeys<P>] extends [never]
        ? {}
        : PolicyArgumentIssues<N, C, Ctx, P, B, Off>
      : {
          [K in Exclude<ResolvedAuthorizedKeys<C, Ctx>, MethodKeys<P>> as `${N}.${K}: .authorize() needs a \`${K}\` method or \`before\` on the policy`]: K
        } & PolicyArgumentIssues<N, C, Ctx, P, B, Off>
  : never;

/**
 * The route proof of `r.contract()` (docs/v1/http.md › Route proof at r.contract()), a low-level type: `Route.api`
 * runs it with the middleware extensions its builder accumulated (H6 #117).
 *
 * For contract (or tree node) `C` named `N` under `Path`, controller instance `I`, middleware extensions `X`, bindings
 * `B`, options `O` and `Off` (the builder's `.withoutImplicitBinding()`): `unknown` when the proof holds (so
 * `K & unknown` is `K`), otherwise an object whose property names are the diagnosis.
 */
export type VerifyController<
  N extends string,
  C,
  Path extends string,
  I,
  X extends object = {},
  B = {},
  O = {},
  Ctx extends EndpointContext = RootContext,
  Off extends boolean = false,
> = Flat<ControllerIssues<N, C, Path, I, X, B, Ctx, Off> & BindIssues<N, C, Path, B> & PolicyIssues<N, C, O, Ctx, B, Off>> extends infer Errs
  ? (keyof Errs extends never ? unknown : Errs)
  : never;
