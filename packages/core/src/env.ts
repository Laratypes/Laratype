import type { StandardSchemaV1 } from '@laratype/contract'

/** The env file: `app/config/env.ts`, which default-exports `defineEnv(schema)`. Not a config: `config()` skips it. */
export const ENV_CONFIG_NAME = 'env'

/** What `defineEnv` returns: the schema the environment is validated with at boot. */
export interface EnvDefinition<S extends StandardSchemaV1 = StandardSchemaV1> {
  readonly schema: S
}

const isStandardSchema = (value: unknown): value is StandardSchemaV1 =>
  typeof (value as StandardSchemaV1 | null)?.['~standard']?.validate === 'function'

/**
 * Declares the environment the app needs, with any Standard Schema (zod 3.25+, valibot, arktype, ...).
 * Default-export it from `app/config/env.ts`: `EnvLoadServiceProvider` validates `process.env` with it at boot, and
 * boot fails on an invalid environment.
 *
 * @example
 * export default defineEnv(z.object({ APP_KEY: z.string().min(32), DB_PORT: z.coerce.number<string>() }))
 */
export const defineEnv = <S extends StandardSchemaV1>(schema: S): EnvDefinition<S> => {
  if (!isStandardSchema(schema)) throw new TypeError('[@laratype/core] defineEnv(schema): schema must be a Standard Schema (zod 3.25+, valibot, arktype, ...)')
  return Object.freeze({ schema })
}
