import { describe, expect, it } from 'vitest'
import * as v from 'valibot'
import * as z from 'zod/v4'
import { z as z3 } from 'zod'
import { issuePath, toErrorBag, validate, validateSync } from '@laratype/contract'
import type { StandardSchemaV1 } from '@laratype/contract'

const isFree = async (email: string) => email !== 'taken@example.com'

const vendors: [string, Record<'query' | 'user' | 'password' | 'root' | 'signup', StandardSchemaV1>][] = [
  [
    'zod 4',
    {
      query: z.object({ page: z.coerce.number<number>() }),
      user: z.object({
        name: z.string().min(1, 'Name is required'),
        address: z.object({ zip: z.string().regex(/^\d{5}$/, 'Invalid zip') }),
        items: z.array(z.object({ name: z.string().min(1, 'Item name is required') })),
      }),
      password: z.object({ password: z.string().min(8, 'Too short').regex(/\d/, 'Needs a digit') }),
      root: z.string(),
      signup: z.object({ email: z.string().refine(isFree, 'Email is taken') }),
    },
  ],
  [
    'valibot',
    {
      query: v.object({ page: v.pipe(v.string(), v.transform(Number)) }),
      user: v.object({
        name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
        address: v.object({ zip: v.pipe(v.string(), v.regex(/^\d{5}$/, 'Invalid zip')) }),
        items: v.array(v.object({ name: v.pipe(v.string(), v.minLength(1, 'Item name is required')) })),
      }),
      password: v.object({ password: v.pipe(v.string(), v.minLength(8, 'Too short'), v.regex(/\d/, 'Needs a digit')) }),
      root: v.string(),
      signup: v.objectAsync({ email: v.pipeAsync(v.string(), v.checkAsync(isFree, 'Email is taken')) }),
    },
  ],
]

const invalidUser = { name: '', address: { zip: 'x' }, items: [{ name: 'ok' }, { name: '' }] }
const invalidUserErrors = {
  name: ['Name is required'],
  'address.zip': ['Invalid zip'],
  'items.1.name': ['Item name is required'],
}

describe.each(vendors)('%s', (_, schemas) => {
  it('sync success returns the parsed output', async () => {
    expect(validateSync(schemas.query, { page: '2' })).toEqual({ ok: true, value: { page: 2 } })
    await expect(validate(schemas.query, { page: '2' })).resolves.toEqual({ ok: true, value: { page: 2 } })
  })

  it('sync failure maps nested and array paths to dot keys', async () => {
    const result = validateSync(schemas.user, invalidUser)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.errors).toEqual(invalidUserErrors)
    expect(!result.ok && result.issues).toHaveLength(3)
    await expect(validate(schemas.user, invalidUser)).resolves.toMatchObject({ ok: false, errors: invalidUserErrors })
  })

  it('collects every message for the same path', () => {
    const result = validateSync(schemas.password, { password: 'abc' })

    expect(!result.ok && result.errors).toEqual({ password: ['Too short', 'Needs a digit'] })
  })

  it('puts issues on the root value under ""', () => {
    const result = validateSync(schemas.root, 42)

    expect(!result.ok && Object.keys(result.errors)).toEqual([''])
    expect(!result.ok && result.errors['']).toHaveLength(1)
  })

  it('validate() awaits async schemas', async () => {
    await expect(validate(schemas.signup, { email: 'new@example.com' })).resolves.toEqual({
      ok: true,
      value: { email: 'new@example.com' },
    })
    await expect(validate(schemas.signup, { email: 'taken@example.com' })).resolves.toMatchObject({
      ok: false,
      errors: { email: ['Email is taken'] },
    })
  })

  it('validateSync() throws on async schemas', () => {
    expect(() => validateSync(schemas.signup, { email: 'new@example.com' })).toThrow(TypeError)
    expect(() => validateSync(schemas.signup, { email: 'new@example.com' })).toThrow(/is async, use validate\(\)/)
  })
})

describe('validate() with zod', () => {
  it.each([['zod 3', z3], ['zod 4', z]] as const)('%s: a throwing refinement runs once, and rejects', async (_, lib) => {
    let calls = 0
    const failure = new Error('boom')
    const schema = (lib.object({ name: lib.string() }) as any).superRefine(() => { calls++; throw failure }) as StandardSchemaV1
    await expect(validate(schema, { name: 'ada' })).rejects.toBe(failure)
    expect(calls).toBe(1)
  })

  it.each([['zod 3', z3], ['zod 4', z]] as const)('%s: issues and output are the ones of ~standard.validate', async (_, lib) => {
    const schema = lib.object({ name: lib.string(), page: lib.coerce.number() }) as unknown as StandardSchemaV1
    const invalid = await validate(schema, { page: '2' })
    expect(invalid.ok).toBe(false)
    expect(invalid).toEqual({ ok: false, errors: toErrorBag((await schema['~standard'].validate({ page: '2' }) as { issues: [] }).issues), issues: expect.any(Array) })
    expect(await validate(schema, { name: 'ada', page: '2' })).toEqual({ ok: true, value: { name: 'ada', page: 2 } })
  })

  it('another vendor with a safeParseAsync method still runs ~standard.validate', async () => {
    const lookalike = { safeParseAsync: () => { throw new Error('not called') }, '~standard': { version: 1, vendor: 'other', validate: (value: unknown) => ({ value }) } } as const
    expect(await validate(lookalike, 1)).toEqual({ ok: true, value: 1 })
  })
})

describe('issuePath', () => {
  it('unwraps { key } segments and gives [] without a path', () => {
    const sym = Symbol('s')
    expect(issuePath({ message: 'x', path: ['items', 0, { key: 'name' }, sym] })).toEqual(['items', 0, 'name', sym])
    expect(issuePath({ message: 'x' })).toEqual([])
  })
})

describe('toErrorBag', () => {
  it('accepts PropertyKey and { key } segments', () => {
    const s = Symbol('s')

    expect(
      toErrorBag([
        { message: 'a', path: ['items', 0, 'name'] },
        { message: 'b', path: [{ key: 'items' }, { key: 0 }, { key: 'name' }] },
        { message: 'c', path: [s] },
        { message: 'd', path: [{ key: s }] },
      ]),
    ).toEqual({ 'items.0.name': ['a', 'b'], 'Symbol(s)': ['c', 'd'] })
  })

  it('uses "" for a missing or empty path', () => {
    expect(toErrorBag([{ message: 'a' }, { message: 'b', path: [] }, { message: 'c', path: undefined }])).toEqual({
      '': ['a', 'b', 'c'],
    })
  })

  it('keeps "__proto__" as a plain key', () => {
    const bag = toErrorBag([{ message: 'a', path: ['__proto__'] }, { message: 'b', path: ['__proto__'] }])

    expect(Object.keys(bag)).toEqual(['__proto__'])
    expect(bag['__proto__']).toEqual(['a', 'b'])
    expect(JSON.stringify(bag)).toBe('{"__proto__":["a","b"]}')
  })

  it('returns an empty bag for no issues', () => {
    expect(toErrorBag([])).toEqual({})
  })
})

describe('validateSync', () => {
  it('throws on a thenable that is not a native Promise', () => {
    const schema: StandardSchemaV1<number> = {
      '~standard': {
        version: 1,
        vendor: 'custom',
        validate: () => ({ then: () => {} }) as unknown as Promise<{ value: number }>,
      },
    }

    expect(() => validateSync(schema, 1)).toThrow(/custom schema is async/)
  })
})
