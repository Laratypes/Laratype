// Type tests: compiled by ../typecheck.test.ts with tsc, so a broken expectation fails `vitest run`.
import { expectTypeOf } from 'vitest'
import * as v from 'valibot'
import * as z from 'zod/v4'
import { endpoint, validate, validateSync } from '@laratype/contract'
import type { ErrorBag, InferIn, InferOut, StandardIssue, ValidationErrorBody, ValidationResult } from '@laratype/contract'

// --- InferIn / InferOut: zod 4
const zQuery = z.object({ page: z.coerce.number<number>(), q: z.string().optional() })
expectTypeOf<InferIn<typeof zQuery>>().toEqualTypeOf<{ page: number; q?: string | undefined }>()
expectTypeOf<InferOut<typeof zQuery>>().toEqualTypeOf<{ page: number; q?: string | undefined }>()
// plain z.coerce.number() has input `unknown`, hence z.coerce.number<number>()
expectTypeOf<InferIn<ReturnType<typeof z.coerce.number>>>().toEqualTypeOf<unknown>()

const zId = z.object({ id: z.string().transform(Number) })
expectTypeOf<InferIn<typeof zId>>().toEqualTypeOf<{ id: string }>()
expectTypeOf<InferOut<typeof zId>>().toEqualTypeOf<{ id: number }>()

// --- InferIn / InferOut: valibot
const vQuery = v.object({ page: v.pipe(v.string(), v.transform(Number)), q: v.optional(v.string()) })
expectTypeOf<InferIn<typeof vQuery>>().toEqualTypeOf<{ page: string; q?: string | undefined }>()
expectTypeOf<InferOut<typeof vQuery>>().toEqualTypeOf<{ page: number; q?: string | undefined }>()

const vAsync = v.objectAsync({ email: v.pipeAsync(v.string(), v.checkAsync(async () => true)) })
expectTypeOf<InferOut<typeof vAsync>>().toEqualTypeOf<{ email: string }>()

// --- both plug into the endpoint builder
const withZod = endpoint.get('/').query(zQuery)
const withValibot = endpoint.post('/').body(vQuery)
expectTypeOf<InferOut<typeof withZod.__types.query>>().toEqualTypeOf<{ page: number; q?: string | undefined }>()
expectTypeOf<InferOut<typeof withValibot.__types.body>>().toEqualTypeOf<{ page: number; q?: string | undefined }>()

// --- validate / validateSync carry the output type
expectTypeOf(validate(zId, {})).resolves.toEqualTypeOf<ValidationResult<{ id: number }>>()
expectTypeOf(validate(vAsync, {})).resolves.toEqualTypeOf<ValidationResult<{ email: string }>>()
expectTypeOf(validateSync(vQuery, {})).toEqualTypeOf<ValidationResult<{ page: number; q?: string | undefined }>>()

declare const result: ValidationResult<{ id: number }>
if (result.ok) {
  expectTypeOf(result.value).toEqualTypeOf<{ id: number }>()
  // @ts-expect-error no error bag on success
  result.errors
} else {
  expectTypeOf(result.errors).toEqualTypeOf<ErrorBag>()
  expectTypeOf(result.issues).toEqualTypeOf<ReadonlyArray<StandardIssue>>()
  // @ts-expect-error no value on failure
  result.value
}

// the bag is the 422 body's `errors`
expectTypeOf<ErrorBag>().toEqualTypeOf<ValidationErrorBody['errors']>()

// @ts-expect-error not a Standard Schema
validate({ parse: (x: unknown) => x }, {})
// @ts-expect-error not a Standard Schema
validateSync(undefined, {})
