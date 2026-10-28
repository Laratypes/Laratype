import type Middleware from "./Middleware";
import type Request from "../supports/Request";

/**
 * The brand of a `defineMiddleware()` value, read by `isTypedMiddleware` and by the request pipeline. A `Symbol.for`
 * key, so it holds across two copies of @laratype/http (CJS and ESM).
 */
export const TYPED_MIDDLEWARE: unique symbol = Symbol.for("laratype.http.typedMiddleware");

/** What typed middleware gets: the 0.5 request (its headers, params and body), and `next`. */
export type MiddlewareHandler<Ext extends object = {}> = (
  request: Request,
  next: (ext?: Ext) => Promise<unknown>,
) => unknown | Promise<unknown>;

/**
 * The typed middleware that `defineMiddleware()` builds (docs/v1/http.md › Typed middleware, H6 #117): it runs before
 * the request is parsed, and `next(ext)` adds the context keys `Ext` to the handler ctx.
 */
export interface TypedMiddleware<Ext extends object = {}> {
  /** Phantom: the context keys the middleware adds, read by the route builder and its proof. */
  readonly __ext?: Ext;
  readonly [TYPED_MIDDLEWARE]: true;
  readonly handle: MiddlewareHandler<Ext>;
}

/** Any typed middleware, whatever it extends, as the runtime sees it. */
export type AnyTypedMiddleware = TypedMiddleware<any>;

/** What `r.middleware()` takes: a 0.5 `Middleware` class, or a `defineMiddleware()` value. */
export type MiddlewareItem = typeof Middleware | AnyTypedMiddleware;

/**
 * Declares the context keys a middleware adds: `defineMiddleware<{ user: User }>((request, next) => next({ user }))`.
 * The route builder accumulates `Ext` and the route proof checks every handler against it (H6 #117).
 */
export const defineMiddleware = <Ext extends object = {}>(handle: MiddlewareHandler<Ext>): TypedMiddleware<Ext> => {
  if (typeof handle !== "function") {
    throw new TypeError(`[@laratype/http] defineMiddleware(): expected a function (request, next), got ${typeof handle}`);
  }
  return Object.freeze({ [TYPED_MIDDLEWARE]: true as const, handle });
};

/** Whether `value` is a `defineMiddleware()` value, not a 0.5 `Middleware` class. */
export const isTypedMiddleware = (value: unknown): value is AnyTypedMiddleware =>
  typeof value === "object" && value !== null && (value as { readonly [TYPED_MIDDLEWARE]?: unknown })[TYPED_MIDDLEWARE] === true;
