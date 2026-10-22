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

/** Env values this long are cut out of every message: a secret that a refinement quotes under another name. */
const ANY = 4;
/** Values this long match anywhere; shorter ones only where they stand alone. */
const LONG = 8;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A value as a message may show it: raw, trimmed, JSON-escaped (valibot quotes it: `received "..."`). */
const forms = (value: string) =>
  [value, value.trim()].flatMap((form) => [form, JSON.stringify(form).slice(1, -1)]).filter((form) => form !== "");

/**
 * One pattern for these values, longest first so a value never leaves part of a longer one. A value of 8+ characters
 * matches anywhere; a shorter one only where it stands alone, so `prod` leaves `"production"` and `0` leaves `>=1024`.
 */
const pattern = (values: ReadonlyArray<string>): RegExp | undefined => {
  const all = [...new Set(values.flatMap(forms))]
    .sort((a, b) => b.length - a.length)
    .map((form) => (form.length >= LONG ? escape(form) : `(?<!\\w)${escape(form)}(?!\\w)`));
  return all.length ? new RegExp(all.join("|"), "g") : undefined;
};

/**
 * Validates `source` (`process.env` at boot) with the env file's definition, and throws one `EnvValidationError`
 * that lists every failing variable. The vendor issues are not kept: some carry the input. Each message has the
 * failing variable's value cut out, and every env value of 4+ characters (a secret a refinement quotes). An error the
 * schema throws (a transform's `new URL(value)`) is replaced, since its message may quote the value.
 */
export const validateEnv = async (definition: EnvDefinition, source: Readonly<Record<string, string | undefined>>): Promise<void> => {
  if (typeof definition?.schema?.["~standard"]?.validate !== "function") {
    throw new TypeError(`[@laratype/support] app/config/${ENV_CONFIG_NAME}.ts must default-export defineEnv(schema)`);
  }
  // A copy: a schema that transforms its input never changes process.env
  const env = { ...source };
  let result: Awaited<ReturnType<typeof validate>>;
  try {
    result = await validate(definition.schema, env);
  } catch (error) {
    // No cause: the error may quote a value
    throw new Error(`[@laratype/support] the schema of app/config/${ENV_CONFIG_NAME}.ts threw (${(error as Error | null)?.name ?? typeof error}) while validating the environment; its message is withheld since it may hold a value`);
  }
  if (result.ok) return;
  const quoted = Object.values(env).filter((value): value is string => typeof value === "string" && value.length >= ANY);
  const issues = Object.entries(result.errors).flatMap(([path, messages]) => {
    const name = path.split(".")[0];
    const own = Object.hasOwn(env, name) ? env[name] : undefined;
    // One pattern: cutting the own value first could split a longer value that contains it
    const values = pattern(typeof own === "string" ? [own, ...quoted] : quoted);
    return messages.map((message) => ({
      name: path === "" ? "(environment)" : path,
      message: values ? message.replace(values, REDACTED) : message,
    }));
  });
  throw new EnvValidationError(issues);
};
