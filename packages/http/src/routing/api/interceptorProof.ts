import type { AnyEndpoint } from "@laratype/contract";
import type { AnyInterceptor, Intercepted } from "../../interceptor/defineInterceptor";
import type { Ctx, EndpointKey, Provided, ReturnMismatch } from "./proof";

/**
 * The interceptor route proof (H11 #138, docs/v1/http.md › Interceptors): an endpoint-pinned interceptor is checked
 * against every endpoint it is mounted on; a generic one is skipped (its handler is result-parametric, and the dev
 * response check is the runtime backstop). `types.ts` resolves the mounted tree entry and intersects the result into
 * the controller parameter of `r.contract()`, as `RouteProof` does.
 */

type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

/** The phantom of an endpoint-pinned interceptor: its endpoint and what it requires from the route. */
type EndpointPinned<A> = A extends {
  readonly __kind: "endpoint";
  readonly __endpoint?: infer E extends AnyEndpoint;
  readonly __requires?: infer R extends object;
}
  ? { endpoint: E; requires: R }
  : never;

/**
 * One interceptor against one endpoint. The result check comes first (the Done-when: the contract response is the final
 * type), then what `next()` promises to the interceptor, then the ctx it reads (extensions and bound models included).
 */
type Issue<N extends string, E extends AnyEndpoint, Path extends string, A, X extends object, B> =
  EndpointPinned<A> extends infer P
    ? P extends { endpoint: infer IE extends AnyEndpoint; requires: infer IReq extends object }
      ? [Intercepted<IE>] extends [Intercepted<E>]
        ? [Intercepted<E>] extends [Intercepted<IE>]
          ? [Provided<E, Path, X, B>] extends [Ctx<IE, IReq>]
            ? never
            : {
                [K in `${N}: interceptor does not accept the handler's ctx`]: {
                  route_provides: Provided<E, Path, X, B>;
                  interceptor_requires: Ctx<IE, IReq>;
                };
              }
          : {
              [K in `${N}: interceptor's next() does not accept the handler's result`]: {
                handler_returns: Intercepted<E>;
                interceptor_next: Intercepted<IE>;
              };
            }
        : {
            [K in `${N}: interceptor result does not match the response schema`]: ReturnMismatch<Intercepted<E>, Intercepted<IE>>;
          }
      : never
    : never;

/** Every endpoint of the contract against every interceptor of the builder: a union of issues, `never` when none. */
type Issues<N extends string, C, Path extends string, I extends readonly AnyInterceptor[], X extends object, B> = {
  [K in EndpointKey<C>]: C[K] extends infer E extends AnyEndpoint
    ? I[number] extends infer A
      ? Issue<`${N}.${K}`, E, Path, A, X, B>
      : never
    : never;
}[EndpointKey<C>];

/** `unknown` when every concrete interceptor fits every endpoint; otherwise an object whose property names diagnose. */
export type InterceptorIssues<
  N extends string,
  C,
  Path extends string,
  I extends readonly AnyInterceptor[],
  X extends object,
  B,
> = [Issues<N, C, Path, I, X, B>] extends [never] ? unknown : UnionToIntersection<Issues<N, C, Path, I, X, B>>;

/**
 * One endpoint callback's interceptor against the endpoint it is registered for: the result checks only. The callback
 * is checked before the options argument, so it does not know the route's bindings or middleware extensions; those are
 * checked for a builder-level interceptor at `r.contract()`.
 */
type CallbackIssues<E extends AnyEndpoint, W extends readonly AnyInterceptor[]> = W[number] extends infer A
  ? EndpointPinned<A> extends infer P
    ? P extends { endpoint: infer IE extends AnyEndpoint }
      ? [Intercepted<IE>] extends [Intercepted<E>]
        ? [Intercepted<E>] extends [Intercepted<IE>]
          ? never
          : {
              "endpoint callback: interceptor's next() does not accept the handler's result": {
                handler_returns: Intercepted<E>;
                interceptor_next: Intercepted<IE>;
              };
            }
        : {
            "endpoint callback: interceptor result does not match the response schema": ReturnMismatch<Intercepted<E>, Intercepted<IE>>;
          }
      : never
    : never
  : never;

/** `unknown` when every interceptor of an `endpoints` callback fits; otherwise the diagnostic object. */
export type EndpointInterceptorFit<E extends AnyEndpoint, W extends readonly AnyInterceptor[]> = [
  CallbackIssues<E, W>,
] extends [never]
  ? unknown
  : UnionToIntersection<CallbackIssues<E, W>>;
