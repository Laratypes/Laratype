// Type tests for isStandardSchema (K4 #314): run by `vitest run --project types`, so a broken expectation fails CI.
import { describe, expectTypeOf, test } from 'vitest'
import * as z from 'zod/v4'
import { isStandardSchema } from '@laratype/contract'
import type { StandardSchemaV1 } from '@laratype/contract'

describe('isStandardSchema (K4 #314)', () => {
  test('narrows unknown to StandardSchemaV1', () => {
    const value: unknown = z.string()
    expectTypeOf(isStandardSchema(value)).toBeBoolean()

    if (isStandardSchema(value)) {
      expectTypeOf(value).toEqualTypeOf<StandardSchemaV1>()
      expectTypeOf(value['~standard'].validate).toBeFunction()
      expectTypeOf(value['~standard'].vendor).toEqualTypeOf<string>()
    }
  })

  test('accepts a value already typed as a schema, and any Standard Schema implementation', () => {
    const schema = z.string()
    expectTypeOf(schema).toExtend<StandardSchemaV1>()
    expectTypeOf(isStandardSchema(schema)).toBeBoolean()

    // callable schemas (arktype) are functions, so the parameter is `unknown`, not `object`
    const callable = Object.assign(() => 'parsed', { '~standard': { version: 1 as const, vendor: 'arktype', validate: (input: unknown) => ({ value: input }) } })
    expectTypeOf(isStandardSchema(callable)).toBeBoolean()
  })
})
