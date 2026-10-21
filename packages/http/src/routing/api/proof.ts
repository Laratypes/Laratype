import type { AnyEndpoint, InferIn, JoinPath, PathParams } from "@laratype/contract";
import type RequestSupport from "../../supports/Request";

/**
 * Controller typing (docs/v1/http.md › Controller typing: Ctx and ControllerOf) and the route proof that
 * `r.contract()` runs on it (› Route proof at r.contract()).
 *
 * The proof is honest about what the runtime passes: until H3 #106 a handler gets the 0.5 request object with the
 * read-only `endpoint`, so that is what the route provides. H3 swaps in `params`, `query` and `body` on both sides.
 */

type T<E extends AnyEndpoint> = E["__types"];
type MaybePromise<X> = X | Promise<X>;

/**
 * A handler's context: the endpoint, plus what the handler requires from the route (middleware extensions and
 * `.bind()`-resolved params). `params`, `query` and `body` come with H3 #106.
 *
 *   async destroy(ctx: Ctx<typeof posts.destroy, { audit: AuditLog }>)
 */
export type Ctx<E extends AnyEndpoint, Requires extends object = {}> = { readonly endpoint: E } & Requires;

/** What a handler returns: the response schema input (the serializer runs afterwards), or nothing without one. */
export type Result<E extends AnyEndpoint> = T<E>["response"] extends undefined ? void : InferIn<T<E>["response"]>;

/** The endpoint keys of a contract or of its tree node (a node also holds its child nodes). */
export type EndpointKey<C> = { [K in keyof C & string]: C[K] extends AnyEndpoint ? K : never }[keyof C & string];

/**
 * Optional: `class PostController implements ControllerOf<typeof posts>` reports a missing handler or a wrong return
 * type at the method. Requirements are checked at `r.contract()` only (`implements` doesn't type params, TS #23911).
 */
export type ControllerOf<C> = {
  [K in EndpointKey<C>]: C[K] extends AnyEndpoint ? (ctx: any) => MaybePromise<Result<C[K]>> : never;
};

// ---- what the route provides ------------------------------------------------

type ModelClass = abstract new (...args: any) => any;
type Resolver = (value: string) => unknown;

/** A `.bind()` value: a model class, or a resolver from the raw param (H7 #118). */
export type Binder = ModelClass | Resolver;

/** A resolver's miss is a 404, so the handler sees the value without `null` / `undefined`. */
type Bound<B> = B extends ModelClass ? InstanceType<B> : B extends Resolver ? NonNullable<Awaited<ReturnType<B>>> : never;

type BoundParams<P, B> = { [K in keyof B & keyof P]: Bound<B[K]> };

/** Every path param of endpoint `E` mounted under `Path`, the tree path of its contract. */
type FullParams<E extends AnyEndpoint, Path extends string> = PathParams<JoinPath<Path, T<E>["path"]>>;

/**
 * What the route passes to the handler of endpoint `E` under `Path`: the request object with `endpoint` (H2a), the
 * middleware extensions `X` and the bound params `B`.
 */
export type Provided<E extends AnyEndpoint, Path extends string, X extends object = {}, B = {}> =
  RequestSupport & { readonly endpoint: E } & X & { params: BoundParams<FullParams<E, Path>, B> };

// ---- the check --------------------------------------------------------------

type RequiredKeys<O> = { [K in keyof O]-?: {} extends Pick<O, K> ? never : K }[keyof O];
type Missing<Pv, Rq> = Exclude<RequiredKeys<Rq>, keyof Pv> & string;
type Mismatched<Pv, Rq> = { [K in keyof Rq & keyof Pv]-?: [Pv[K]] extends [Rq[K]] ? never : K }[keyof Rq & keyof Pv] & string;
type Sub<O, K extends string> = K extends keyof O ? O[K] : {};
type Flat<O> = { [K in keyof O]: O[K] } & {};
type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/** Keys the handler needs that the route doesn't provide: `user`, `params.user`. */
type MissingKeys<Pv, Rq> = Missing<Pv, Rq> | `params.${Missing<Sub<Pv, "params">, Sub<Rq, "params">>}`;

/** Keys both sides have, where the provided type doesn't satisfy the required one (`params` is compared per key). */
type MismatchedKeys<Pv, Rq> =
  | Exclude<Mismatched<Pv, Rq>, "params">
  | `params.${Mismatched<Sub<Pv, "params">, Sub<Rq, "params">>}`;

type At<O, P extends string> = P extends `params.${infer K}` ? Sub<Sub<O, "params">, K> : Sub<O, P>;

/*
 * Readable errors: the diagnosis is in the PROPERTY NAMES of the error type, since tsc prints the names of missing
 * properties in full but truncates property types to `{ ...; }`. The values hold the details.
 */
type RequirementIssues<N extends string, Pv, Rq> = {
  [M in MissingKeys<Pv, Rq> as `${N}: handler requires \`${M}\`, route does not provide it (add middleware / .bind())`]: {
    handler_requires: At<Rq, M>;
  };
} & {
  [M in MismatchedKeys<Pv, Rq> as M extends "endpoint"
    ? `${N}: handler ctx is typed for a different endpoint`
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

/**
 * Conditional types, not function assignability: methods compare bivariantly, so `{ show(ctx: Provided): any }`
 * would accept a handler that needs more than the route provides. `[Provided] extends [Param]` is one-directional.
 * Any callable property counts as a handler (class methods, and an `action()` property later).
 */
type HandlerIssues<N extends string, E extends AnyEndpoint, H, Pv> = H extends (ctx: infer Rq, ...rest: any[]) => infer R
  ? [Pv] extends [Rq]
    ? [Awaited<R>] extends [Result<E>]
      ? {}
      : { [_ in `${N}: return type does not match the response schema`]: ReturnMismatch<Result<E>, Awaited<R>> }
    : RequirementIssues<N, Pv, Rq>
  : { [_ in `${N}: controller has no handler for this endpoint`]: H };

type HandlerOf<I, K> = K extends keyof I ? I[K] : undefined;

type ControllerIssues<N extends string, C, Path extends string, I, X extends object, B> = UnionToIntersection<
  {
    [K in EndpointKey<C>]: C[K] extends infer E extends AnyEndpoint
      ? // The extensions of the endpoint's own `endpoints` middleware join `X` with typed middleware (H6 #117)
        HandlerIssues<`${N}.${K}`, E, HandlerOf<I, K>, Provided<E, Path, X, B>>
      : {};
  }[EndpointKey<C>]
>;

type AllPathParams<C, Path extends string> = {
  [K in EndpointKey<C>]: C[K] extends infer E extends AnyEndpoint ? keyof FullParams<E, Path> : never;
}[EndpointKey<C>];

type BindIssues<N extends string, C, Path extends string, B> = {
  [K in Exclude<keyof B, AllPathParams<C, Path>> & string as `.bind(): \`${K}\` is not a path param of any endpoint in ${N}`]: B[K];
};

/** Endpoint keys with their own `.authorize()`: each needs a policy method of the same name, or `before`. */
type AuthorizedKeys<C> = { [K in EndpointKey<C>]: C[K] extends { readonly __types: { caps: { authorize: true } } } ? K : never }[EndpointKey<C>];

type PolicyOf<O> = O extends { readonly policy: infer P extends abstract new (...args: any) => any } ? InstanceType<P> : undefined;

type PolicyIssues<N extends string, C, O> = PolicyOf<O> extends infer P
  ? [P] extends [undefined]
    ? { [K in AuthorizedKeys<C> as `${N}.${K}: endpoint has .authorize() but r.contract() has no { policy }`]: K }
    : "before" extends keyof P
      ? {}
      : { [K in Exclude<AuthorizedKeys<C>, keyof P> as `${N}.${K}: .authorize() needs a \`${K}\` method or \`before\` on the policy`]: K }
  : never;

/**
 * The route proof of `r.contract()` (docs/v1/http.md › Route proof at r.contract()), a low-level type: `Route.api`
 * runs it with `X = {}` and `B = {}` until typed middleware (H6 #117) and `r.bind()` (H7 #118) feed the builder.
 *
 * For contract (or tree node) `C` named `N` under `Path`, controller instance `I`, middleware extensions `X`,
 * bindings `B` and options `O`: `unknown` when the proof holds (so `K & unknown` is `K`), otherwise an object whose
 * property names are the diagnosis.
 */
export type VerifyController<N extends string, C, Path extends string, I, X extends object = {}, B = {}, O = {}> =
  Flat<ControllerIssues<N, C, Path, I, X, B> & BindIssues<N, C, Path, B> & PolicyIssues<N, C, O>> extends infer Errs
    ? (keyof Errs extends never ? unknown : Errs)
    : never;
