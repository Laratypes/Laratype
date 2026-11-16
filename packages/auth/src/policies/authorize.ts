import ForbiddenException from "../exceptions/ForbiddenException";

/** The `before` hook of a policy: `true` allows, `false` denies, anything else (usually `null`) has no opinion. */
const before = async (policy: object, user: unknown, ability: string, args: readonly unknown[]): Promise<boolean | null> => {
  const hook = (policy as { before?: unknown }).before;
  // 0.5 policies declare before(actor, ability); a v1 one may read the arguments too (docs/v1/auth.md › Policies and gates)
  if (typeof hook !== "function") return null;
  const answer = await hook.call(policy, user, ability, ...args);
  return typeof answer === "boolean" ? answer : null;
};

/** The ability method of a policy, or `undefined`: a method only, so a field, `before` or `constructor` never runs. */
const abilityMethod = (policy: object, ability: string): ((...args: unknown[]) => unknown) | undefined => {
  if (ability === "constructor" || ability === "before") return undefined;
  const method = (policy as Record<string, unknown>)[ability];
  return typeof method === "function" ? method as (...args: unknown[]) => unknown : undefined;
};

/**
 * Runs one check of a policy instance (#121): `before` first, then the ability method (docs/v1/auth.md › Policies and
 * gates). `true` allows and `false` denies; `null` means neither decided, which a scope hook (http.md › Authorization
 * from the contract) reads as "no opinion", while `policyAllows()` and `policyAuthorize()` deny it.
 */
export const policyCheck = async (
  policy: object,
  user: unknown,
  ability: string,
  ...args: unknown[]
): Promise<boolean | null> => {
  // A guest never reaches a policy, whatever the caller passed: a policy written for a signed-in user must not decide
  // on `undefined` (docs/v1/auth.md › Invariants)
  if (user === undefined || user === null) return false;
  const hook = await before(policy, user, ability, args);
  if (hook !== null) return hook;
  const method = abilityMethod(policy, ability);
  if (!method) return null;
  // Only an explicit true allows: a truthy string, an object or a promise of one denies (docs/v1/auth.md › Invariants)
  return (await method.call(policy, user, ...args)) === true;
};

/** Whether the policy allows `ability`: `policyCheck()` resolves `true`, as every caller of a single check does. */
export const policyAllows = async (
  policy: object,
  user: unknown,
  ability: string,
  ...args: unknown[]
): Promise<boolean> => (await policyCheck(policy, user, ability, ...args)) === true;

/**
 * Runs the check and throws the derived 403 unless it allows: a denial, or a policy with neither `before` nor the
 * ability, throws `ForbiddenException` (`{ code: "FORBIDDEN" }`). #105 calls it for an endpoint's policy.
 */
export const policyAuthorize = async (
  policy: object,
  user: unknown,
  ability: string,
  ...args: unknown[]
): Promise<void> => {
  if (!(await policyAllows(policy, user, ability, ...args))) {
    throw new ForbiddenException();
  }
};
