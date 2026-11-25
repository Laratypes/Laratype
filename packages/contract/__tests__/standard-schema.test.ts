import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import * as z from 'zod/v4'
import { isStandardSchema } from '@laratype/contract'

/** A minimal Standard Schema, callable like an arktype schema when `callable` is set. */
const custom = (validate: unknown) => ({ '~standard': { version: 1 as const, vendor: 'custom', validate } })

describe('isStandardSchema (K4 #314)', () => {
  it('accepts zod, valibot and a callable schema (arktype schemas are functions)', () => {
    expect(isStandardSchema(z.object({ id: z.string() }))).toBe(true)
    expect(isStandardSchema(v.object({ id: v.string() }))).toBe(true)
    const arktype = Object.assign(() => 'parsed', custom((value: unknown) => ({ value })))
    expect(typeof arktype).toBe('function')
    expect(isStandardSchema(arktype)).toBe(true)
  })

  it('rejects null, undefined, primitives and anything without a ~standard.validate function', () => {
    const values = [
      null,
      undefined,
      0,
      1n,
      true,
      '',
      'zod',
      Symbol('schema'),
      [],
      {},
      Object.create(null),
      { parse: () => ({ success: true }) },
      { safeParseAsync: () => ({ success: true }) },
      { '~standard': null },
      { '~standard': undefined },
      { '~standard': 1 },
      { '~standard': 'zod' },
      { '~standard': {} },
      { '~standard': { validate: null } },
      { '~standard': { validate: 1 } },
      { '~standard': { validate: 'parse' } },
      { '~standard': { version: 1, vendor: 'custom' } },
    ]

    for (const value of values) expect(isStandardSchema(value)).toBe(false)
  })

  it('reads ~standard and validate once each: a getter cannot pass with one value and answer another', () => {
    let standardReads = 0
    let validateReads = 0
    const schema = Object.defineProperty({}, '~standard', {
      get() {
        standardReads++
        return Object.defineProperty({}, 'validate', {
          get() {
            validateReads++
            return (value: unknown) => ({ value })
          },
        })
      },
    })

    expect(isStandardSchema(schema)).toBe(true)
    expect(standardReads).toBe(1)
    expect(validateReads).toBe(1)
  })

  it('propagates an error from a ~standard getter or a Proxy get trap: a schema is app data, never hidden', () => {
    const failure = new Error('boom')
    const throwingGetter = Object.defineProperty({}, '~standard', { get() { throw failure } })
    const throwingProxy = new Proxy({}, { get() { throw failure } })

    expect(() => isStandardSchema(throwingGetter)).toThrow(failure)
    expect(() => isStandardSchema(throwingProxy)).toThrow(failure)
  })

  it('accepts a Proxy around a schema', () => {
    const proxied = new Proxy(z.object({ id: z.string() }), {
      get: (target, key, receiver) => Reflect.get(target, key, receiver),
    })

    expect(isStandardSchema(proxied)).toBe(true)
  })
})
