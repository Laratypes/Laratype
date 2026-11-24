/**
 * Whether `user` is a user, not a guest: the model instance a guard loaded. A guest is every non-object — `null`,
 * `undefined`, `false` (what `TokenGuard.user()` answers for a request with no bearer token), a primitive such as a
 * user id or an API-key string, a symbol, a function — and fails closed before a policy or a gate runs
 * (docs/v1/auth.md › Invariants, A3 #121). The guards load a user with `findOneBy()`, and `issueToken()` takes an
 * instance, so a real user is always an object.
 */
export const isUser = (user: unknown): user is object => user !== null && typeof user === "object";
