import type { AnyEndpoint, EndpointTypes, InferIn, InferOut, PathParams } from "@laratype/contract";
import type ResponseSupport from "../../supports/Response";
import type JsonResource from "../../resource/json/JsonResource";
import type RequestSupport from "../../supports/Request";
import type Controller from "../../controller/Controller";

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

/** `Base` with `Extra` on top, `params` merged one level deep (a bound param replaces its string). */
type Merge<Base, Extra> = Flat<
  Omit<Base, keyof Extra> &
    Omit<Extra, "params"> &
    ("params" extends keyof Extra ? { params: Flat<Omit<Sub<Base, "params">, keyof Extra["params"]> & Extra["params"]> } : {})
>;

/**
 * A handler's context: `BaseCtx` plus what the handler requires from the route (middleware extensions and
 * `.bind()`-resolved params). `Ctx` knows the endpoint's own path params; a folder param (`user` of
 * `users/[user]/posts`) is listed in `Requires`.
 *
 *   async index({ query }: Ctx<typeof posts.index>)
 *   async destroy({ params }: Ctx<typeof posts.destroy, { params: { post: Post } }>)
 */
export type Ctx<E extends AnyEndpoint, Requires extends object = {}> = Merge<BaseCtx<E>, Requires>;

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

type ModelClass = abstract new (...args: any) => any;
type Resolver = (value: string) => unknown;

/** A `.bind()` value: a model class, or a resolver from the raw param (H7 #118). */
export type Binder = ModelClass | Resolver;

/** A resolver's miss is a 404, so the handler sees the value without `null` / `undefined`. */
type Bound<B> = B extends ModelClass ? InstanceType<B> : B extends Resolver ? NonNullable<Awaited<ReturnType<B>>> : never;

type BoundParams<P, B> = { [K in keyof B & keyof P]: Bound<B[K]> };

/** Every path param of endpoint `E` mounted under `Path`, the tree path of its contract, as the client sees them. */
type FullParams<E extends AnyEndpoint, Path extends string> = EndpointTypes<E, { path: Path; scopes: []; options: {} }>["params"];

/**
 * What the route passes to the handler of endpoint `E` under `Path`: `BaseCtx` with every path param of the full
 * path (folder params included), the middleware extensions `X` and the bound params `B` in place of their strings.
 */
export type Provided<E extends AnyEndpoint, Path extends string, X extends object = {}, B = {}> =
  Merge<BaseCtx<E, FullParams<E, Path>>, X & { params: BoundParams<FullParams<E, Path>, B> }>;

// ---- the check --------------------------------------------------------------

type RequiredKeys<O> = { [K in keyof O]-?: {} extends Pick<O, K> ? never : K }[keyof O];
type Missing<Pv, Rq> = Exclude<RequiredKeys<Rq>, keyof Pv> & string;
type Mismatched<Pv, Rq> = { [K in keyof Rq & keyof Pv]-?: [Pv[K]] extends [Rq[K]] ? never : K }[keyof Rq & keyof Pv] & string;
type Sub<O, K extends string> = K extends keyof O ? O[K] : {};
type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

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
type RequirementIssues<N extends string, Pv, Rq> = {
  [M in MissingKeys<Pv, Rq> as MissingLabel<N, M, Rq>]: {
    handler_requires: At<Rq, M>;
  };
} & {
  [M in MismatchedKeys<Pv, Rq> as M extends "endpoint"
    ? `${N}: handler ctx is typed for a different endpoint`
    : M extends "query" | "body"
      ? `${N}: \`${M}\` of the ctx does not match the handler (it is the output of the endpoint's ${M} schema)`
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
 */
type HandlerIssues<N extends string, E extends AnyEndpoint, H, Pv, Raw> = IsAny<H> extends true
  ? {}
  : H extends (ctx: infer Rq, ...rest: infer Rest) => infer R
    ? [Pv] extends [Rq]
      ? [Awaited<R>] extends [Result<E> | NoBody<E> | ResponseEscape]
        ? SecondIssues<N, Rest, Raw>
        : { [_ in `${N}: return type does not match the response schema`]: ReturnMismatch<Result<E>, Awaited<R>> }
      : Unexplained<N, Pv, Rq, Flat<RequirementIssues<N, Pv, Rq>>>
    : { [_ in `${N}: controller has no handler for this endpoint`]: H };

/** The handler for key `K`: a member of the controller, never one of the base `Controller` (the runtime rejects those). */
type HandlerOf<I, K> = K extends Exclude<keyof I, keyof Controller> ? I[K] : undefined;

type ControllerIssues<N extends string, C, Path extends string, I, X extends object, B> = UnionToIntersection<
  {
    [K in EndpointKey<C>]: C[K] extends infer E extends AnyEndpoint
      ? HandlerIssues<`${N}.${K}`, E, HandlerOf<I, K>, Provided<E, Path, X, B>, { [P in keyof FullParams<E, Path>]: string }>
      : {};
  }[EndpointKey<C>]
>;

type AllPathParams<C, Path extends string> = {
  [K in EndpointKey<C>]: C[K] extends infer E extends AnyEndpoint ? keyof FullParams<E, Path> : never;
}[EndpointKey<C>];

type BindIssues<N extends string, C, Path extends string, B> = {
  [K in Exclude<keyof B, AllPathParams<C, Path>> & string as `.bind(): \`${K}\` is not a path param of any endpoint in ${N}`]: B[K];
};

/** Endpoint keys with their own `.authorize()` (or `.authorize(flag)`): each needs a policy method of the same name, or `before`. */
type AuthorizedKeys<C> = {
  [K in EndpointKey<C>]: C[K] extends { readonly __types: { caps: { authorize: infer F } } } ? (true extends F ? K : never) : never;
}[EndpointKey<C>];

/** The method names of a policy instance: a property that is not a function doesn't count. */
type MethodKeys<P> = { [K in keyof P]-?: P[K] extends (...args: any) => any ? K : never }[keyof P];

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

type PolicyIssues<N extends string, C, O> = PolicyOf<O> extends infer P
  ? [unknown] extends [P]
    ? {}
    : [P] extends [undefined]
    ? { [K in AuthorizedKeys<C> as `${N}.${K}: endpoint has .authorize() but r.contract() has no { policy }`]: K }
    : "before" extends MethodKeys<P>
      ? {}
      : { [K in Exclude<AuthorizedKeys<C>, MethodKeys<P>> as `${N}.${K}: .authorize() needs a \`${K}\` method or \`before\` on the policy`]: K }
  : never;

/**
 * The route proof of `r.contract()` (docs/v1/http.md › Route proof at r.contract()), a low-level type: `Route.api`
 * runs it with the middleware extensions its builder accumulated (H6 #117).
 *
 * For contract (or tree node) `C` named `N` under `Path`, controller instance `I`, middleware extensions `X`, bindings
 * `B` and options `O`: `unknown` when the proof holds (so `K & unknown` is `K`), otherwise an object whose property
 * names are the diagnosis.
 */
export type VerifyController<N extends string, C, Path extends string, I, X extends object = {}, B = {}, O = {}> =
  Flat<ControllerIssues<N, C, Path, I, X, B> & BindIssues<N, C, Path, B> & PolicyIssues<N, C, O>> extends infer Errs
    ? (keyof Errs extends never ? unknown : Errs)
    : never;
