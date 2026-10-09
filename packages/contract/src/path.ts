export type Prettify<T> = { [K in keyof T]: T[K] } & {};

type Segment<S extends string> =
  S extends `:${infer N}?` ? { [K in N]?: string }
  : S extends `:${infer N}` ? { [K in N]: string }
  : {};

type Split<P extends string> = P extends `${infer H}/${infer T}` ? Segment<H> & Split<T> : Segment<P>;

/** "/users/:user/posts/:post?" -> { user: string; post?: string } */
export type PathParams<P extends string> = Prettify<Split<P>>;
