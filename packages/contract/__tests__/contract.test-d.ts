// Type tests: run by `vitest run --typecheck.only` (C6 #94), so a broken expectation fails CI.
import { describe, expectTypeOf, test } from 'vitest'
import * as v from 'valibot'
import * as z from 'zod/v4'
import type { InferIn, InferOut, PathParamKeys, PathParams, StandardSchemaV1 } from '@laratype/contract'

describe('PathParams', () => {
  test('required, optional and regex params', () => {
    expectTypeOf<PathParams<'/health'>>().toEqualTypeOf<{}>()
    expectTypeOf<PathParams<'/users/:user/posts/:post?'>>().toEqualTypeOf<{ user: string; post?: string }>()
    expectTypeOf<PathParams<'/posts/:id{[0-9]+}'>>().toEqualTypeOf<{ id: string }>()
    expectTypeOf<PathParams<'/files/*'>>().toEqualTypeOf<{}>()
  })

  test('PathParamKeys', () => {
    expectTypeOf<PathParamKeys<'/teams/:team/users/:user?'>>().toEqualTypeOf<'team' | 'user'>()
    expectTypeOf<PathParamKeys<'/health'>>().toEqualTypeOf<never>()
  })

  test('negatives', () => {
    // @ts-expect-error a required param cannot be omitted
    const missing: PathParams<'/users/:user'> = {}
    // @ts-expect-error the regex pattern never leaks into the key
    const leaked: PathParams<'/posts/:id{[0-9]+}'> = { 'id{[0-9]+}': '1' }
    void missing, leaked
  })
})

describe('Standard Schema inference', () => {
  test('zod 4', () => {
    const schema = z.object({ id: z.string().transform(Number) })
    expectTypeOf(schema).toExtend<StandardSchemaV1>()
    expectTypeOf<InferIn<typeof schema>>().toEqualTypeOf<{ id: string }>()
    expectTypeOf<InferOut<typeof schema>>().toEqualTypeOf<{ id: number }>()
  })

  test('valibot', () => {
    const schema = v.object({ page: v.pipe(v.string(), v.transform(Number)), q: v.optional(v.string()) })
    expectTypeOf(schema).toExtend<StandardSchemaV1>()
    expectTypeOf<InferIn<typeof schema>>().toEqualTypeOf<{ page: string; q?: string | undefined }>()
    expectTypeOf<InferOut<typeof schema>>().toEqualTypeOf<{ page: number; q?: string | undefined }>()
  })

  test('an empty slot projects to undefined', () => {
    expectTypeOf<InferIn<undefined>>().toEqualTypeOf<undefined>()
    expectTypeOf<InferOut<undefined>>().toEqualTypeOf<undefined>()
  })

  test('negatives', () => {
    // @ts-expect-error a plain object is not a Standard Schema
    const notASchema: StandardSchemaV1 = { parse: (x: unknown) => x }
    void notASchema
  })
})
