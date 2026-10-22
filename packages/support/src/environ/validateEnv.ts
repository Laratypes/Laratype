import { ENV_CONFIG_NAME } from "@laratype/core";
import type { EnvDefinition } from "@laratype/core";
import { validate } from "@laratype/contract";

/** One failing variable: its name and the schema's message, with the variable's value redacted. */
export interface EnvIssue {
  readonly name: string;
  readonly message: string;
}

/** Boot fails with this when the environment does not match the `defineEnv` schema. It never holds a value. */
export class EnvValidationError extends Error {
  override readonly name = "EnvValidationError";

  constructor(readonly issues: ReadonlyArray<EnvIssue>) {
    super(
      `[@laratype/support] Invalid environment (app/config/${ENV_CONFIG_NAME}.ts), ${issues.length} failing:\n`
      + issues.map((issue) => `  - ${issue.name}: ${issue.message}`).join("\n"),
    );
  }
}

const REDACTED = "***";

/** Values this long are cut out of every message, wherever they appear: a secret quoted under another name. */
const ANYWHERE = 8;
/** Shorter values of a failing variable are cut out only where they stand alone, so `0` leaves `>=1024` readable. */
const SUBSTRING = 4;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The value as it may appear in a message: raw, and JSON-escaped (valibot quotes it: `received "..."`). */
const forms = (value: string) => [...new Set([value, JSON.stringify(value).slice(1, -1)])].map(escape);

/** One pattern for the values to cut out of a message, longest first so a value never leaves part of a longer one. */
const redaction = (values: ReadonlyArray<string>): RegExp | undefined => {
  const patterns = [...new Set(values)]
    .filter((value) => value !== "")
    .sort((a, b) => b.length - a.length)
    .flatMap((value) => forms(value).map((form) => (value.length < SUBSTRING ? `(?<![\\w])${form}(?![\\w])` : form)));
  return patterns.length ? new RegExp(patterns.join("|"), "g") : undefined;
};

/**
 * Validates `source` (`process.env` at boot) with the env file's definition, and throws one `EnvValidationError`
 * that lists every failing variable. The vendor issues are not kept: some carry the input. Each message has the
 * failing variable's value cut out, and every env value of 8+ characters (a secret a refinement quotes).
 */
export const validateEnv = async (definition: EnvDefinition, source: Readonly<Record<string, string | undefined>>): Promise<void> => {
  if (typeof definition?.schema?.["~standard"]?.validate !== "function") {
    throw new TypeError(`[@laratype/support] app/config/${ENV_CONFIG_NAME}.ts must default-export defineEnv(schema)`);
  }
  // A copy: a schema that transforms its input never changes process.env
  const env = { ...source };
  const result = await validate(definition.schema, env);
  if (result.ok) return;
  const failing = Object.entries(result.errors).map(([path, messages]) => ({ path, name: path.split(".")[0], messages }));
  const longValues = Object.values(env).filter((value): value is string => typeof value === "string" && value.length >= ANYWHERE);
  const issues = failing.flatMap(({ path, name, messages }) => {
    const own = Object.hasOwn(env, name) ? env[name] : undefined;
    const pattern = redaction(typeof own === "string" ? [own, ...longValues] : longValues);
    return messages.map((message) => ({
      name: path === "" ? "(environment)" : path,
      message: pattern ? message.replace(pattern, REDACTED) : message,
    }));
  });
  throw new EnvValidationError(issues);
};
