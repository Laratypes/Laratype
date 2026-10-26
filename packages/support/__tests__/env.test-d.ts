// Type tests for the env validation error (K1 #152): run by `bunx vitest run --project types`.
import { describe, expectTypeOf, test } from 'vitest'
import { EnvValidationError } from '../src/environ/validateEnv'
import type { EnvIssue } from '../src/environ/validateEnv'

describe('EnvValidationError', () => {
  test('lists names and messages only', () => {
    expectTypeOf<EnvValidationError['issues']>().toEqualTypeOf<ReadonlyArray<EnvIssue>>()
    expectTypeOf<EnvIssue>().toEqualTypeOf<{ readonly name: string; readonly message: string }>()
    expectTypeOf<EnvValidationError>().toExtend<Error>()
  })
})
