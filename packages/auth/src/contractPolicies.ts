import { registerContractPolicies } from "@laratype/http";
import type { ContractPolicyChecks } from "@laratype/http";
import { policyAuthorize, policyCheck } from "./policies/authorize";

/**
 * Links the A3 policy checks to the router (H8 #122): `policyCheck` / `policyAuthorize` are registered as they are,
 * and @laratype/http runs the route chain. No policy semantics move into http, and this module exports nothing.
 *
 * The marker `@laratype/http` reads on the registered value. It lets a reloaded module, or a second copy of this
 * package, replace the value it registered instead of throwing. It is not a security boundary: any in-process code can
 * set it; it only tells a second copy of @laratype/auth from an unrelated value.
 */
const CONTRACT_POLICIES_BRAND: unique symbol = Symbol.for("laratype.auth.contractPolicyChecks");

const checks: ContractPolicyChecks = { check: policyCheck, authorize: policyAuthorize };
Object.defineProperty(checks, CONTRACT_POLICIES_BRAND, {
  value: true,
  enumerable: false,
  writable: false,
  configurable: false,
});

// H8 #122: `Route.api` runs its routes' resolved scope and endpoint policies with these checks. The import of
// @laratype/auth is what makes the enforcement available; a route with authorize fails mount() when it is missing.
registerContractPolicies(checks);
