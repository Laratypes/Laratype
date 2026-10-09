import type { AnyEndpoint, ErrorDef, InferIn, InferOut, PathParams, Prettify } from "../../contract";

type T<E extends AnyEndpoint> = E["__types"];
type MaybePromise<X> = X | Promise<X>;

/** What every handler gets from the contract alone (validated input). */
export type BaseCtx<E extends AnyEndpoint> = {
  readonly endpoint: E;
  params: PathParams<T<E>["path"]>;
  query: InferOut<T<E>["query"]>;
  body: InferOut<T<E>["body"]>;
};

/** Shallow merge, except `params`, which is merged one level deep (bindings override path strings). */
type Merge<B, X> = Prettify<
  Omit<B, keyof X> & {
    [K in keyof X]: K extends "params" ? (K extends keyof B ? Prettify<Omit<B[K], keyof X[K]> & X[K]> : X[K]) : X[K];
  }
>;

/**
 * Handler context = contract input + what the handler *requires* from the route
 * (middleware extensions and `.bind()`-resolved params).
 *   async show(ctx: Ctx<typeof users.show, { params: { user: User }; user: User }>)
 */
export type Ctx<E extends AnyEndpoint, Requires extends object = {}> = Merge<BaseCtx<E>, Requires>;

// ---- results ---------------------------------------------------------------

export const ERROR_REPLY: unique symbol = Symbol.for("laratype.errorReply");
type BodyOf<D> = D extends ErrorDef<any, infer B> ? B : never;

export interface ErrorReply<D extends ErrorDef> {
  readonly [ERROR_REPLY]: D;
  readonly status: D["status"];
  readonly body: BodyOf<D>;
}

/** `return fail(errors.notFound, { message })` — only errors declared on the endpoint type-check. */
export const fail = <D extends ErrorDef>(def: D, body: BodyOf<D>): ErrorReply<D> =>
  ({ [ERROR_REPLY]: def, status: def.status, body }) as ErrorReply<D>;

/** What a handler may return: the response schema *input* (serializer runs after), or a declared error. */
export type Result<E extends AnyEndpoint> =
  | (T<E>["response"] extends undefined ? void : InferIn<T<E>["response"]>)
  | ([T<E>["errors"]] extends [never] ? never : ErrorReply<T<E>["errors"]>);

export type Handler<E extends AnyEndpoint, C> = (ctx: C) => MaybePromise<Result<E>>;

// ---- Option B: property handlers ------------------------------------------

export const ACTION: unique symbol = Symbol.for("laratype.action");

/** Callable, so the route check and the runtime treat A (method) and B (property) the same way. */
export type Action<E extends AnyEndpoint, C> = Handler<E, C> & { readonly [ACTION]: E };

/**
 * show = action(users.show, async ({ params }) => ...)                       // ctx contextually typed: Ctx<E>
 * show = action(users.show, async ({ user }: Ctx<typeof users.show, { user: User }>) => ...) // declares requirements
 */
export function action<E extends AnyEndpoint, C extends object = Ctx<E>>(endpoint: E, handler: Handler<E, C>): Action<E, C> {
  return Object.assign((ctx: C) => handler(ctx), { [ACTION]: endpoint });
}

/**
 * Option A, optional: `class UserController implements ControllerOf<typeof users>` gives exhaustiveness and
 * return-type errors AT THE METHOD (implements does not contextually type params, see TS#23911, but it does
 * check the declared/inferred method type). Requirements are still only checkable at the route.
 */
export type ControllerOf<C> = {
  [K in Exclude<keyof C, symbol> as C[K] extends AnyEndpoint ? K : never]: C[K] extends AnyEndpoint ? (ctx: any) => MaybePromise<Result<C[K]>> : never;
};
