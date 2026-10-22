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

/** Schema messages may quote the input (valibot: `received "..."`), so the value is cut out of them. */
const redact = (message: string, value: unknown): string => {
  if (typeof value !== "string" || value === "") return message;
  let out = message;
  for (const form of new Set([value, JSON.stringify(value).slice(1, -1)])) out = out.split(form).join(REDACTED);
  return out;
};

/**
 * Validates `source` (`process.env` at boot) with the env file's definition, and throws one `EnvValidationError`
 * that lists every failing variable. The vendor issues are not kept: some carry the input.
 */
export const validateEnv = async (definition: EnvDefinition, source: Readonly<Record<string, string | undefined>>): Promise<void> => {
  if (typeof definition?.schema?.["~standard"]?.validate !== "function") {
    throw new TypeError(`[@laratype/support] app/config/${ENV_CONFIG_NAME}.ts must default-export defineEnv(schema)`);
  }
  // A copy: a schema that transforms its input never changes process.env
  const env = { ...source };
  const result = await validate(definition.schema, env);
  if (result.ok) return;
  const issues = Object.entries(result.errors).flatMap(([path, messages]) => {
    const name = path.split(".")[0];
    const value = Object.hasOwn(env, path) ? env[path] : Object.hasOwn(env, name) ? env[name] : undefined;
    return messages.map((message) => ({ name: path === "" ? "(environment)" : path, message: redact(message, value) }));
  });
  throw new EnvValidationError(issues);
};
