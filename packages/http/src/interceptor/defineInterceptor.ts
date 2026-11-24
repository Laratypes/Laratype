import type { AnyEndpoint } from "@laratype/contract";
import type { Ctx, ResponseEscape, Result } from "../routing/api/proof";

/**
 * The brand of a `defineInterceptor()` value, read by `isInterceptor()`. A `Symbol.for` key, so it holds across two
 * copies of @laratype/http (CJS and ESM).
 */
export const INTERCEPTOR: unique symbol = Symbol.for("laratype.http.interceptor");

/**
 * The type-only overload kind (H11 #138, amendment B): an endpoint-pinned interceptor cannot be mounted on a scope.
 * It is a declaration only: `defineInterceptor()` writes the brand above, never this member, and `isInterceptor()`
 * cannot tell the two forms apart at runtime (the scope check is a compile-time rule).
 */
type InterceptorKind = "endpoint" | "generic";

/** proof.ts's NoBody: an endpoint without a response schema may return null. */
type NoBody<E extends AnyEndpoint> = E["__types"]["response"] extends undefined ? null : never;

/** What a handler may return, and what `next()` resolves to: the response schema input, no body, or a 0.5 escape. */
export type Intercepted<E extends AnyEndpoint> = Result<E> | NoBody<E> | ResponseEscape;

/** The handler of an endpoint-pinned interceptor: it gets the route's ctx and the handler, and returns its contract type. */
export type InterceptorHandler<E extends AnyEndpoint = AnyEndpoint, Requires extends object = {}> = (
  ctx: Ctx<E, Requires>,
  next: () => Promise<Intercepted<E>>,
) => Intercepted<E> | Promise<Intercepted<E>>;

/**
 * The handler of a generic (result-parametric) interceptor: it can only pass through, or return, what `next()` gave
 * it. A cache hit needs an explicit `as R` cast; the dev response check is the runtime backstop (H11 #138, amendment A).
 */
export type GenericInterceptorHandler = <R>(
  ctx: Ctx<AnyEndpoint>,
  next: () => Promise<R>,
) => R | Promise<R>;

/** The endpoint-pinned interceptor `defineInterceptor<Endpoint>()` builds (the export list keeps this type internal). */
export interface EndpointInterceptor<E extends AnyEndpoint = AnyEndpoint, Requires extends object = {}> {
  readonly __kind: InterceptorKind & "endpoint";
  readonly __endpoint?: E;
  readonly __requires?: Requires;
  readonly [INTERCEPTOR]: true;
  readonly handle: InterceptorHandler<E, Requires>;
}

/** The generic interceptor `defineInterceptor()` builds: it mounts on any endpoint, contract or scope. */
export interface GenericInterceptor {
  readonly __kind: InterceptorKind & "generic";
  readonly [INTERCEPTOR]: true;
  readonly handle: GenericInterceptorHandler;
}

/**
 * A `defineInterceptor()` value: endpoint-pinned (checked against the endpoint's ctx and result) or generic (mounts
 * anywhere, result-parametric). The kind is a phantom: both forms are the same frozen `{ handle }` value at runtime.
 */
export type Interceptor<E extends AnyEndpoint = AnyEndpoint, Requires extends object = {}> =
  | EndpointInterceptor<E, Requires>
  | GenericInterceptor;

/** Any interceptor, whatever its endpoint, as `r.interceptor()` takes it. */
export type AnyInterceptor = Interceptor<any, any>;

/**
 * Declares an interceptor around the handler (H11 #138, docs/v1/http.md › Interceptors):
 *
 *   const log = defineInterceptor((ctx, next) => next())                       // generic, mounts anywhere
 *   const trim = defineInterceptor<typeof posts.show>(async (ctx, next) => {   // pinned to posts.show
 *     const value = await next()
 *     return { ...value, title: value.title.trim() }
 *   })
 *
 * The generic overload comes first, so a call without a type argument builds the result-parametric form; pass the
 * endpoint type argument to pin the interceptor to that endpoint's ctx and response type. `defineInterceptor()` freezes
 * a `{ handle }` value branded with a `Symbol.for` key, so it holds across CJS/ESM copies.
 */
export function defineInterceptor(handle: GenericInterceptorHandler): GenericInterceptor;
export function defineInterceptor<E extends AnyEndpoint = never, Requires extends object = {}>(
  handle: InterceptorHandler<E, Requires>,
): EndpointInterceptor<E, Requires>;
export function defineInterceptor(
  handle: InterceptorHandler<any, any> | GenericInterceptorHandler,
): EndpointInterceptor<any, any> | GenericInterceptor {
  if (typeof handle !== "function") {
    throw new TypeError(`[@laratype/http] defineInterceptor(): expected a function (ctx, next), got ${typeof handle}`);
  }
  return Object.freeze({ [INTERCEPTOR]: true as const, handle }) as unknown as EndpointInterceptor<any, any> | GenericInterceptor;
}

/** Whether `value` is a `defineInterceptor()` value. One brand for both forms: the kind is type-only. */
export const isInterceptor = (value: unknown): value is AnyInterceptor =>
  typeof value === "object" &&
  value !== null &&
  (value as { readonly [INTERCEPTOR]?: unknown })[INTERCEPTOR] === true &&
  typeof (value as { readonly handle?: unknown }).handle === "function";

/** The name the runtime errors print for an interceptor: the handle's function name, or `interceptor`. */
export const interceptorName = (interceptor: AnyInterceptor): string => interceptor.handle.name || "interceptor";
