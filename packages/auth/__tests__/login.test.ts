// The password is checked with Hash.check() after the lookup, never matched in the query
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ContextApi, Hash } from '@laratype/support'
import Authentication from '../src/passport/Authentication'
import { Auth } from '../src'
import { GuardStore } from '../src/support/GuardStore'

/** sha256('secret'), the 0.5 format. */
const SHA256_SECRET = '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b'

type Row = { id: number; email: string; password: string }

/** The slice of a typeorm Model that login uses, over rows in memory; the password column is { select: false } by default. */
const fakeModel = (rows: Row[], { select = false } = {}) => {
  const calls = { where: [] as object[], addSelect: [] as string[], update: [] as [unknown, object][] }
  class User {
    static getRepository() {
      return {
        metadata: {
          findColumnWithPropertyName: (name: string) => (name === 'password' ? { propertyPath: 'password', isSelect: select } : undefined),
        },
        update: async (id: number, data: Partial<Row>) => {
          calls.update.push([id, data])
          Object.assign(rows.find((row) => row.id === id)!, data)
        },
      }
    }
    static createQueryBuilder(alias: string) {
      let where: Record<string, unknown> = {}
      const qb = {
        where(value: Record<string, unknown>) {
          where = value
          calls.where.push(value)
          return qb
        },
        addSelect(selection: string) {
          calls.addSelect.push(selection)
          expect(selection.startsWith(`${alias}.`)).toBe(true)
          return qb
        },
        async getOne() {
          const row = rows.find((r) => Object.entries(where).every(([key, value]) => r[key as keyof Row] === value))
          return row ? { ...row } : null
        },
      }
      return qb
    }
    static getId(user: Row) {
      return user.id
    }
  }
  return { User, calls }
}

const guardOf = (provider: unknown, options: object = { usernameField: 'email', passwordField: 'password' }) => ({ provider, options })

describe('Authentication.login', () => {
  it('finds the user by the other fields and checks the password with Hash.check()', async () => {
    const { User, calls } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    const user = await Authentication.login(guardOf(User), { email: 'ada@example.com', password: 'secret' })
    expect(user).toEqual({ id: 1, email: 'ada@example.com' })
    expect(calls.where).toEqual([{ email: 'ada@example.com' }])
    expect(calls.addSelect).toEqual(['user.password'])
    expect(calls.update).toEqual([])
  })

  it('refuses a wrong password and an unknown user', async () => {
    const { User } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    expect(await Authentication.login(guardOf(User), { email: 'ada@example.com', password: 'wrong' })).toBeNull()
    expect(await Authentication.login(guardOf(User), { email: 'bob@example.com', password: 'secret' })).toBeNull()
  })

  it('keeps the password on the user when the column is selectable, as a plain lookup does', async () => {
    const hashed = Hash.make('secret')
    const { User, calls } = fakeModel([{ id: 1, email: 'ada@example.com', password: hashed }], { select: true })
    expect(await Authentication.login(guardOf(User), { email: 'ada@example.com', password: 'secret' })).toEqual({
      id: 1,
      email: 'ada@example.com',
      password: hashed,
    })
    expect(calls.update).toEqual([])
  })

  it('logs in a 0.5 sha256 user once and replaces the hash with a scrypt one', async () => {
    const rows = [{ id: 7, email: 'old@example.com', password: SHA256_SECRET }]
    const { User, calls } = fakeModel(rows)
    expect(await Authentication.login(guardOf(User), { email: 'old@example.com', password: 'secret' })).toEqual({ id: 7, email: 'old@example.com' })
    expect(calls.update).toHaveLength(1)
    expect(Hash.isHashed(rows[0]!.password)).toBe(true)
    expect(Hash.check('secret', rows[0]!.password)).toBe(true)

    expect(await Authentication.login(guardOf(User), { email: 'old@example.com', password: 'secret' })).not.toBeNull()
    expect(calls.update).toHaveLength(1)
  })

  it('does not rehash on a failed login', async () => {
    const { User, calls } = fakeModel([{ id: 7, email: 'old@example.com', password: SHA256_SECRET }])
    expect(await Authentication.login(guardOf(User), { email: 'old@example.com', password: 'wrong' })).toBeNull()
    expect(calls.update).toEqual([])
  })

  it('never queries without a password or a lookup field', async () => {
    const { User, calls } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    expect(await Authentication.login(guardOf(User), { email: 'ada@example.com' })).toBeNull()
    expect(await Authentication.login(guardOf(User), { password: 'secret' })).toBeNull()
    expect(await Authentication.login(guardOf(User), { email: undefined, password: 'secret' })).toBeNull()
    expect(await Authentication.login(guardOf(User), { email: 'ada@example.com', password: 42 })).toBeNull()
    expect(calls.where).toEqual([])
  })

  it('reads the password under the guard passwordField', async () => {
    const { User, calls } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    const guard = guardOf(User, { usernameField: 'email', passwordField: 'pass' })
    await expect(Authentication.login(guard, { email: 'ada@example.com', pass: 'secret' })).rejects.toThrow(
      '[@laratype/auth] User has no "pass" column (the guard\'s passwordField)',
    )
    expect(calls.where).toEqual([])
  })
})

describe('Auth.guard().attempt()', () => {
  let saved: unknown
  beforeEach(() => {
    saved = globalThis.__laratype_auth_config
  })
  afterEach(() => {
    globalThis.__laratype_auth_config = saved as any
  })

  it('authenticates through the same check', async () => {
    const { User } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    GuardStore.setAuthConfig({ default: { guard: 'web' }, guards: { web: guardOf(User) } } as any)
    await ContextApi.run({ user: undefined } as any, async () => {
      const auth = Auth.guard('web')
      expect(await auth.attempt({ email: 'ada@example.com', password: 'wrong' })).toBe(false)
      const authenticated = await auth.attempt({ email: 'ada@example.com', password: 'secret' })
      expect(authenticated && (authenticated as any).user).toEqual({ id: 1, email: 'ada@example.com' })
    })
  })
})
