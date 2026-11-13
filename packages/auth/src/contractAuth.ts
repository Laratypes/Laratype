import { errors } from "@laratype/contract";
import { defineMiddleware, registerContractAuth } from "@laratype/http";
import type { ContractAuthFactory, TypedMiddleware } from "@laratype/http";
import { authManager } from "./guard/resolve";
import { setAuthenticatedUser } from "./support/guardContext";
import type { GuardName, GuardUser, RegisteredUser } from "./Register";

/**
 * Links the contract's guard registry to the app's `Register` (A2 #120): the contract reads `GuardName` and
 * `GuardUser<A>` from these values, and never imports this package. `true` is the app's default user.
 */
declare module "@laratype/contract" {
  interface AuthRegisterLink {
    user: RegisteredUser;
    guards: { [K in GuardName]: GuardUser<K> };
  }
}

/**
 * The guard a contract endpoint declares: `true` for the default guard of `app/config/auth.ts`, or a registered name.
 * `auth()` with no argument uses the default guard too.
 */
export const auth = <G extends true | GuardName = true>(guard?: G): TypedMiddleware<{ user: GuardUser<G> }> =>
  defineMiddleware<{ user: GuardUser<G> }>(async (request, next) => {
    // The contract passes its resolved auth (`true` or a guard name) to the factory; an app-written auth() passes
    // nothing, which also means the default guard.
    const name = guard === undefined || guard === true ? undefined : (guard as GuardName);
    const tokenGuard = authManager().guard<GuardUser<G>>(name);
    const user = await tokenGuard.user(request);
    if (!user) {
      // The contract's derived 401, as declared by the endpoint's auth capability (contract.md › Capabilities)
      throw errors.unauthorized();
    }
    // A6 #335: Auth.user() and Auth.login() then sign for the guard that authenticated this request.
    setAuthenticatedUser(user, tokenGuard.name);
    return next({ user });
  });

/**
 * The marker `@laratype/http` reads on the registered factory (A2 #120). It lets a reloaded module, or a second copy
 * of this package, replace the factory it registered instead of throwing. It is not a security boundary: any
 * in-process code can set it; it only tells a second copy of @laratype/auth from an unrelated value.
 */
const CONTRACT_AUTH_BRAND: unique symbol = Symbol.for("laratype.auth.contractAuthFactory");

// A2 #120: `Route.api` enforces the resolved auth of its routes with this factory. The import of @laratype/auth is
// what makes the enforcement available; a route with auth fails mount() when it is missing.
const factory: ContractAuthFactory = (guard) => auth(guard as true | GuardName);
Object.defineProperty(factory, CONTRACT_AUTH_BRAND, {
  value: true,
  enumerable: false,
  writable: false,
  configurable: false,
});
registerContractAuth(factory);
