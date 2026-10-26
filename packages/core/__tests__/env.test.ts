import { describe, expect, it } from 'vitest'
import * as z from 'zod/v4'
import { defineEnv } from '@laratype/core'

describe('defineEnv (K1 #152)', () => {
  it('keeps the schema', () => {
    const schema = z.object({ A: z.string() })
    expect(defineEnv(schema).schema).toBe(schema)
    expect(Object.isFrozen(defineEnv(schema))).toBe(true)
  })

  it('rejects what is not a Standard Schema', () => {
    expect(() => defineEnv({} as never)).toThrow(new TypeError('[@laratype/core] defineEnv(schema): schema must be a Standard Schema (zod 3.25+, valibot, arktype, ...)'))
  })
})
