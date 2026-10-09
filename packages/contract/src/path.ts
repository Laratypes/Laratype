export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** "id{[0-9]+}" -> "id": the Hono regex pattern never leaks into the key */
type ParamName<S extends string> = S extends `${infer N}{${string}` ? N : S;

type Param<N extends string, Optional extends boolean> =
  N extends "" ? {}
  : Optional extends true ? { [K in N]?: string }
  : { [K in N]: string };

/** ":id" | ":id?" | ":id{re}" | ":id{re}?" -> param; "*", "static", "" -> nothing (same as Hono) */
type Segment<S extends string> =
  S extends `:${infer Rest}`
    ? Rest extends `${infer N}?` ? Param<ParamName<N>, true> : Param<ParamName<Rest>, false>
  : {};

/** Splits on "/", but keeps a "/" that sits inside a regex pattern (":file{.+/.+}") in its segment. */
type Split<P extends string> =
  P extends `${infer H}/${infer T}`
    ? H extends `${string}{${string}`
      ? H extends `${string}}${string}` ? Segment<H> & Split<T> : Split<`${H}\u0000${T}`>
      : Segment<H> & Split<T>
  : Segment<P>;

/**
 * Typed path params, following Hono's route syntax:
 * - "/users/:user/posts/:post?" -> { user: string; post?: string }
 * - "/posts/:id{[0-9]+}"        -> { id: string }
 * - "/files/*", "/users/:id/"   -> wildcards and trailing slashes add no params
 */
export type PathParams<P extends string> = Prettify<Split<P>>;

export type PathParamKeys<P extends string> = keyof PathParams<P> & string;
