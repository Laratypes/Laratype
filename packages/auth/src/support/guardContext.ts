import { ContextApi } from "@laratype/support";

/**
 * The guard that authenticated the current request, per request store (A6 #335): `ContextApi` keeps the user only,
 * so this package records the guard name beside it. A `WeakMap` keyed by the store keeps the entry request-scoped and
 * lets it go with the store.
 */
const authenticatedGuards = new WeakMap<object, string>();

/**
 * Binds `user` to the current request and, when `guardName` is given, records it as the guard that authenticated it:
 * `Auth.user()` and `Auth.login()` then sign for that guard. Nothing happens outside a request.
 */
export const setAuthenticatedUser = (user: unknown, guardName?: string): void => {
  ContextApi.setUser(user);
  const store = ContextApi.getRequestStore().getStore();
  if (store && guardName) {
    authenticatedGuards.set(store, guardName);
  }
};

/** The guard that authenticated the current request, or `undefined` when none did (or outside a request). */
export const authenticatedGuard = (): string | undefined => {
  const store = ContextApi.getRequestStore().getStore();
  return store ? authenticatedGuards.get(store) : undefined;
};
