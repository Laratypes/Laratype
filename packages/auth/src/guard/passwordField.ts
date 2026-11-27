/**
 * The credential column a guard checks: `options.passwordField`, else the provider model's `static passwordField`,
 * else `password`. A model that declares another column throws, so a guard that would hash one field and check another
 * fails at boot (`PassportGuard.register()`) instead of on every login (`TokenGuard.attempt()`).
 */
export const passwordFieldOf = (
  model: { name: string; passwordField?: string },
  configured: string | undefined,
): string => {
  const declared = model.passwordField;
  const passwordField = configured ?? declared ?? "password";
  if (typeof declared === "string" && declared !== passwordField) {
    throw new Error(
      `[@laratype/auth] ${model.name} hashes "${declared}", not the guard's passwordField "${passwordField}": set static passwordField on the model, or use the same name in options.`,
    );
  }
  return passwordField;
};
