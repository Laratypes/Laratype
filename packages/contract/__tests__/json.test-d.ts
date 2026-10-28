// Type tests: run by `vitest run --typecheck.only` (C6 #94), so a broken expectation fails CI.
import { describe, expectTypeOf, test } from 'vitest'
import * as z from 'zod/v4'
import type { InferOut, Jsonify } from '@laratype/contract'

describe('Jsonify (the wire type, #107)', () => {
  test('primitives stay, toJSON is followed, non-JSON values are dropped', () => {
    expectTypeOf<Jsonify<string | number | boolean | null>>().toEqualTypeOf<string | number | boolean | null>()
    expectTypeOf<Jsonify<'a' | 1>>().toEqualTypeOf<'a' | 1>()
    expectTypeOf<Jsonify<Date>>().toEqualTypeOf<string>()
    expectTypeOf<Jsonify<string | undefined>>().toEqualTypeOf<string>()
    expectTypeOf<Jsonify<bigint>>().toEqualTypeOf<never>()
    expectTypeOf<Jsonify<Map<string, number>>>().toEqualTypeOf<{}>()
    expectTypeOf<Jsonify<unknown>>().toEqualTypeOf<unknown>()
  })

  test('objects: a property that may be undefined is optional, a non-JSON one is dropped', () => {
    type Wire = Jsonify<{ readonly a: string; b: string | undefined; c?: Date; d: undefined; e: () => void; [k: symbol]: number }>
    expectTypeOf<Wire>().toEqualTypeOf<{ a: string; b?: string; c?: string }>()
  })

  test('arrays and tuples: a non-JSON item becomes null', () => {
    expectTypeOf<Jsonify<readonly Date[]>>().toEqualTypeOf<string[]>()
    expectTypeOf<Jsonify<[Date, undefined, number]>>().toEqualTypeOf<[string, null, number]>()
  })

  test('the output of a response schema', () => {
    const User = z.object({ id: z.number(), joined: z.date(), tags: z.array(z.string()).optional() })
    expectTypeOf<Jsonify<InferOut<typeof User>>>().toEqualTypeOf<{ id: number; joined: string; tags?: string[] }>()
  })
})
