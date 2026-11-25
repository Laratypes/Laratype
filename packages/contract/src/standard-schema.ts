// Minimal copy of the Standard Schema v1 spec (https://standardschema.dev).
// Type-only so the contract stays schema-agnostic (zod 3.25+, valibot, arktype, ...).
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

export interface StandardIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

export type StandardResult<O> =
  | { readonly value: O; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardIssue> };

export type InferIn<S> = S extends StandardSchemaV1 ? NonNullable<S["~standard"]["types"]>["input"] : undefined;
export type InferOut<S> = S extends StandardSchemaV1 ? NonNullable<S["~standard"]["types"]>["output"] : undefined

/**
 * Whether `value` is a Standard Schema: an object or function whose `~standard.validate` is a function. A function
 * counts because an arktype schema is callable. The one guard `defineEnv`, `validateEnv` and `Request.rules()` use.
 * Reading `~standard` runs a getter, and a Proxy's get trap: an error it throws propagates (a schema is app data, so
 * the guard never hides the app's bug), as the inline checks it replaces did.
 */
export const isStandardSchema = (value: unknown): value is StandardSchemaV1 => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  const standard = (value as { readonly "~standard"?: unknown })["~standard"];
  return typeof standard === "object" && standard !== null && typeof (standard as { readonly validate?: unknown }).validate === "function";
};
