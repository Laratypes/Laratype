/**
 * Exact type equality, by the compiler's structural comparison: `true` when `X` and `Y` are the same type, `false` when
 * one is only assignable to the other. Shared by the route proof (`proof.ts`) and the route builder (`types.ts`), which
 * matches middleware by identity and not by subtype (H6 #117).
 */
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

/** `true` when `X` is exactly one of the types of `S`; `never` otherwise (so `S = never` gives `never`). */
export type Matches<X, S> = S extends unknown ? (Equal<X, S> extends true ? true : never) : never;
