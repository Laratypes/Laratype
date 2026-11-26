/**
 * The slot where `@laratype/auth` registers the checks of a route's contract policies (H8 #122). A `Symbol.for` key on
 * `globalThis`, so the auth package and the router agree across two copies of @laratype/http. The checks are A3's
 * `policyCheck` / `policyAuthorize`, reused as is; @laratype/http owns the route chain (order, fail closed) and the
 * policy classes are built by the request container, so this package never imports @laratype/auth.
 */
const CONTRACT_POLICIES: unique symbol = Symbol.for("laratype.http.contractPolicies");

/**
 * The marker `@laratype/auth` sets on the value it registers (H8 #122). A second copy of the package, or a reload of
 * the module, builds another object, so a branded value replaces a branded one. It is not a security boundary: any
 * in-process code can set it; it only tells a second copy of @laratype/auth from an unrelated value.
 */
const CONTRACT_POLICIES_BRAND: unique symbol = Symbol.for("laratype.auth.contractPolicyChecks");

/**
 * The half that answered a scope check and its answer: `before` (a boolean `true` is the scope bypass) or the ability
 * method. A `null` check means `before` had no opinion and the ability name matches no method.
 */
type ContractPolicyCheck = { readonly by: "before" | "ability"; readonly answer: boolean };

/**
 * The single-policy checks of A3: `check` is `policyCheck` tagged with the half that answered, and `authorize` is
 * `policyAuthorize` (the derived 403 unless the policy allows). `@laratype/auth` builds them from A3's internals
 * without changing the public `policyCheck` / `policyAllows` / `policyAuthorize` behaviour.
 */
export interface ContractPolicyChecks {
  check(policy: object, user: unknown, ability: string, ...args: unknown[]): Promise<ContractPolicyCheck | null>;
  authorize(policy: object, user: unknown, ability: string, ...args: unknown[]): Promise<void>;
}

interface Snapshot {
  readonly check: ContractPolicyChecks["check"];
  readonly authorize: ContractPolicyChecks["authorize"];
}

type Slot = { [CONTRACT_POLICIES]?: unknown };

const describeValue = (value: unknown): string =>
  value === null ? "null" : typeof value === "function" ? `a function (${value.name || "anonymous"})` : typeof value;

const isBranded = (value: unknown): boolean =>
  ((typeof value === "object" && value !== null) || typeof value === "function") &&
  (value as { [CONTRACT_POLICIES_BRAND]?: unknown })[CONTRACT_POLICIES_BRAND] === true;

const isFunction = (value: unknown): value is (...args: unknown[]) => unknown => typeof value === "function";

/**
 * A frozen copy of the registered functions, read once: a getter or a `Proxy` cannot answer validation with one
 * function and the requests with another. `undefined` when the value is not a complete `{ check, authorize }` of
 * functions (an untrusted slot value counts as "not imported").
 */
const snapshot = (value: unknown): Snapshot | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const check = (value as { check?: unknown }).check;
  const authorize = (value as { authorize?: unknown }).authorize;
  if (!isFunction(check) || !isFunction(authorize)) return undefined;
  // define the brand before freezing: a branded value from a second copy of @laratype/auth must stay recognizable
  const copy: Record<PropertyKey, unknown> = { check, authorize };
  if (isBranded(value)) Object.defineProperty(copy, CONTRACT_POLICIES_BRAND, { value: true });
  return Object.freeze(copy) as unknown as Snapshot;
};

/**
 * Fills the contract policy slot. `@laratype/auth` calls it once on import with `policyCheck` / `policyAuthorize`.
 * The same two functions twice are fine. A branded value replaces a branded one (last wins), so a reloaded module or a
 * second copy of the package does not throw. Any other complete, different value throws, so a policy check is never
 * silently replaced; an incomplete value (no function `check` or `authorize`) is not a registration and is replaced.
 */
export function registerContractPolicies(checks: ContractPolicyChecks): void {
  const next = snapshot(checks);
  if (next === undefined) {
    const value = checks as unknown;
    const member = typeof value === "object" && value !== null && !isFunction((value as { check?: unknown }).check)
      ? "check"
      : "authorize";
    throw new Error(
      `[@laratype/http] registerContractPolicies(): expected { check, authorize } from @laratype/auth, got ${describeValue(value)}` +
        `${typeof value === "object" && value !== null ? ` (${member} is not a function)` : ""}.`,
    );
  }
  const slot = globalThis as Slot;
  const existing = slot[CONTRACT_POLICIES];
  const current = snapshot(existing);
  if (existing === undefined || current === undefined) {
    slot[CONTRACT_POLICIES] = next;
    return;
  }
  if (current.check === next.check && current.authorize === next.authorize) return;
  if (isBranded(existing) && isBranded(next)) {
    slot[CONTRACT_POLICIES] = next;
    return;
  }
  const found = current.check.name || current.authorize.name || "an anonymous function";
  throw new Error(
    `[@laratype/http] registerContractPolicies(): the contract policy checks are already registered (${found}), so a second, different value would replace them. Fix: import @laratype/auth once, or remove the other package that registers the slot.`,
  );
}

/**
 * The registered contract policy checks, or `undefined` when `@laratype/auth` was not imported (or the slot does not
 * hold a complete `{ check, authorize }`: it is untrusted, so anything else is "not imported" and `Route.api` fails
 * closed). The returned value is a frozen copy of the two functions read once.
 */
export function contractPolicies(): ContractPolicyChecks | undefined {
  return snapshot((globalThis as Slot)[CONTRACT_POLICIES]) as ContractPolicyChecks | undefined;
}
