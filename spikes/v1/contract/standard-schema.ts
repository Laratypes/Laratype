// Minimal copy of the Standard Schema v1 spec (https://standardschema.dev)
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

export type StandardResult<O> =
  | { readonly value: O; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string; readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined }> };

export type InferIn<S> = S extends StandardSchemaV1 ? NonNullable<S["~standard"]["types"]>["input"] : undefined;
export type InferOut<S> = S extends StandardSchemaV1 ? NonNullable<S["~standard"]["types"]>["output"] : undefined;
