import type Middleware from "./Middleware";
import type Request from "../supports/Request";

/**
 * The brand of a `defineMiddleware()` value, read by `isTypedMiddleware()`. A `Symbol.for` key, so it holds across two
 * copies of @laratype/http (CJS and ESM).
 */
export const TYPED_MIDDLEWARE: unique symbol = Symbol.for("laratype.http.typedMiddleware");

/**
 * What typed middleware gets: the 0.5 request (its headers, params and body), and `next`, which takes the extension
 * `Ext` — required when `Ext` has a required key, optional when every key is optional or `Ext` is `{}`. Named apart from
 * the 0.5 `MiddlewareHandler` (`(request, res, next)`) it would otherwise shadow in the package exports (H6 #117).
 */
export type TypedMiddlewareHandler<Ext extends object = {}> = (
  request: Request,
  next: (...args: {} extends Ext ? [ext?: Ext] : [ext: Ext]) => Promise<unknown>,
) => unknown | Promise<unknown>;

/**
 * The typed middleware that `defineMiddleware()` builds (docs/v1/http.md › Typed middleware, H6 #117): it runs after
 * the 0.5 request body is parsed, before contract input validation builds the handler ctx, and `next(ext)` adds the
 * context keys `Ext` to that ctx.
 */
export interface TypedMiddleware<Ext extends object = {}> {
  /** Phantom: the context keys the middleware adds, read by the route builder and its proof. */
  readonly __ext?: Ext;
  readonly [TYPED_MIDDLEWARE]: true;
  readonly handle: TypedMiddlewareHandler<Ext>;
}

/** Any typed middleware, whatever it extends, as the runtime sees it. */
export type AnyTypedMiddleware = TypedMiddleware<any>;

/** What `r.middleware()` takes: a 0.5 `Middleware` class, or a `defineMiddleware()` value. */
export type MiddlewareItem = typeof Middleware | AnyTypedMiddleware;

/**
 * Declares the context keys a middleware adds: `defineMiddleware<{ user: User }>((request, next) => next({ user }))`.
 * The route builder accumulates `Ext` and the route proof checks every handler against it (H6 #117).
 */
export const defineMiddleware = <Ext extends object = {}>(
  handle: TypedMiddlewareHandler<Ext>,
): TypedMiddleware<Ext> => {
  if (typeof handle !== "function") {
    throw new TypeError(`[@laratype/http] defineMiddleware(): expected a function (request, next), got ${typeof handle}`);
  }
  return Object.freeze({ [TYPED_MIDDLEWARE]: true as const, handle });
};

/** Whether `value` is a `defineMiddleware()` value, not a 0.5 `Middleware` class. */
export const isTypedMiddleware = (value: unknown): value is AnyTypedMiddleware =>
  typeof value === "object" && value !== null && (value as { readonly [TYPED_MIDDLEWARE]?: unknown })[TYPED_MIDDLEWARE] === true;

/** The name the runtime errors print for a middleware: a 0.5 class's name, or a typed middleware's handle name. */
export const middlewareName = (middleware: MiddlewareItem): string =>
  typeof middleware === "function" ? middleware.name : middleware.handle.name || "middleware";
