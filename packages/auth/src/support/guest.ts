/**
 * Whether `user` is a guest: any non-object, `null` included. `TokenGuard.user()` answers `false` for a request with
 * no bearer token, and a `false`, a `0`, a `""`, a `NaN`, a number, a symbol or a function must fail closed like
 * `undefined` and `null`, before a policy or a gate runs (docs/v1/auth.md › Invariants, #394 round 5). A user is a
 * model instance, always an object: the guards load one with `findOneBy()`, and `issueToken()` takes an instance.
 */
export const isGuest = (user: unknown): boolean => user === null || typeof user !== "object";
