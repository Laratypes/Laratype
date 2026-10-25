import { ENV_CONFIG_NAME } from "@laratype/core";
import type { EnvDefinition } from "@laratype/core";
import { validate } from "@laratype/contract";
import type { StandardIssue } from "@laratype/contract";

/** One failing variable. The message is fixed: schema text may quote a value (see `validateEnv`). */
export interface EnvIssue {
  readonly name: string;
  readonly message: string;
}

/** The only message an issue carries: no text from the schema is ever printed. */
const INVALID_MESSAGE = "does not match the schema";

/** The hint a 0.5 app with a plain `app/config/env.ts` config needs. */
const NOT_DEFINE_ENV =
  `[@laratype/support] app/config/${ENV_CONFIG_NAME}.ts must default-export defineEnv(schema)`
  + " (a 0.5 config named env: rename the file, e.g. app/config/environment.ts)";

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

/** The first path segment of an issue, when it is a string key. */
const keyOf = (issue: StandardIssue): string | undefined => {
  const first = issue.path?.[0];
  const key = typeof first === "object" && first !== null ? first.key : first;
  return typeof key === "string" ? key : undefined;
};

/**
 * The variables the schema declares, without any env value: the keys of the issues it reports for an empty input
 * (a missing variable's path). A schema that throws on it declares none.
 */
const declaredNames = async (definition: EnvDefinition): Promise<ReadonlySet<string>> => {
  try {
    const result = await validate(definition.schema, {});
    return new Set(result.ok ? [] : result.issues.map(keyOf).filter((key): key is string => key !== undefined));
  } catch {
    return new Set();
  }
};

/**
 * The variable of an issue: its first path segment, which may itself contain a dot (`db.password`). The path comes
 * from the schema, which can key it by a (transformed) value, so a segment is printed only when it is a variable of
 * `env` or a name the schema declares (`declaredNames`); anything else is `(environment)`.
 */
const nameOf = (issue: StandardIssue, env: Readonly<Record<string, string | undefined>>, declared: ReadonlySet<string>): string => {
  const key = keyOf(issue);
  return key !== undefined && (Object.hasOwn(env, key) || declared.has(key)) ? key : "(environment)";
};

/**
 * Validates `source` (`process.env` at boot) with the env file's definition, and throws one
 * `EnvValidationError` that lists each failing variable once. The vendor issues are not kept, and no text from the
 * schema is printed: a schema can transform its input before a check (lowercase, `decodeURIComponent`, base64) and then
 * quote that transformed value, which no redaction of the raw env value can catch. Only the variable names and a fixed
 * message are printed. An error the schema throws (a transform's `new URL(value)`) is replaced for the same reason.
 */
export const validateEnv = async (definition: EnvDefinition, source: Readonly<Record<string, string | undefined>>): Promise<void> => {
  if (typeof definition?.schema?.["~standard"]?.validate !== "function") {
    throw new TypeError(NOT_DEFINE_ENV);
  }
  // A copy: a schema that transforms its input never changes process.env
  const env = { ...source };
  let result: Awaited<ReturnType<typeof validate>>;
  try {
    result = await validate(definition.schema, env);
  } catch (error) {
    // No cause, no name: the error, even its name, may quote a value
    throw new Error(`[@laratype/support] the schema of app/config/${ENV_CONFIG_NAME}.ts threw while validating the environment; the error is withheld since it may hold a value`);
  }
  if (result.ok) return;
  // One line per name, however many of its checks failed; issues with no path share the (environment) line
  const declared = await declaredNames(definition);
  const issues: EnvIssue[] = [];
  const seen = new Set<string>();
  for (const issue of result.issues) {
    const name = nameOf(issue, env, declared);
    if (seen.has(name)) continue;
    seen.add(name);
    issues.push({ name, message: INVALID_MESSAGE });
  }
  throw new EnvValidationError(issues);
};
