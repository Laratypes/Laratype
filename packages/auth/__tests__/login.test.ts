// The password is checked with Hash.check() after the lookup, never matched in the query
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { Container, depsRegistry } from '@laratype/core'
import { ContextApi, Hash } from '@laratype/support'
import { Auth, AuthManager, PassportGuard } from '../src'

/** sha256('secret'), the 0.5 format. */
const SHA256_SECRET = '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b'

type Row = { id: number; [key: string]: any }

/** The slice of a typeorm Model that the login uses, over rows in memory; the password column is { select: false } by default. */
const fakeModel = (rows: Row[], { column = 'password', select = false, failUpdate = false } = {}) => {
  const calls = { where: [] as object[], addSelect: [] as string[], update: [] as [unknown, object][] }
  const builders = vi.fn()
  const findOneBy = vi.fn(async () => null)
  class User {
    static getRepository() {
      return {
        metadata: {
          findColumnWithPropertyName: (name: string) => (name === column ? { propertyPath: column, isSelect: select } : undefined),
        },
        update: async (id: number, data: Partial<Row>) => {
          calls.update.push([id, data])
          if (failUpdate) throw new Error('the database is down')
          Object.assign(rows.find((row) => row.id === id)!, data)
        },
      }
    }
    static createQueryBuilder(alias: string) {
      builders()
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
          // A typeorm entity: the login reads the column and the caller keeps the model's identity
          const row = rows.find((r) => Object.entries(where).every(([key, value]) => r[key as keyof Row] === value))
          return row ? Object.assign(new User(), row) : null
        },
      }
      return qb
    }
    static getId(user: Row) {
      return user.id
    }
  }
  return { User, calls, builders, findOneBy }
}

const options = (custom: Record<string, unknown> = {}) => ({ usernameField: 'email', passwordField: 'password', ...custom })

const configOf = (provider: unknown, custom: Record<string, unknown> = {}) => ({
  default: { guard: 'web' },
  guards: {
    web: {
      strategyName: 'local',
      strategy: class {},
      options: options(custom),
      provider,
      verification: 'jwt',
    },
  },
})

/** Runs `callback` in a request whose container holds an `AuthManager` over `provider`, as RequestKernel does. */
const inApp = <T>(provider: unknown, callback: () => Promise<T>, custom: Record<string, unknown> = {}): Promise<T> => {
  const container = new Container({ deps: depsRegistry })
  container.instance(AuthManager, new AuthManager(configOf(provider, custom) as any))
  return ContextApi.run({ container } as any, callback) as unknown as Promise<T>
}

/** `Auth.guard('web').attempt()`, flattened to the user or `null`, as a caller sees it. */
const attempt = (provider: unknown, fields: Record<string, any>, custom: Record<string, unknown> = {}) =>
  inApp(provider, async () => {
    const authenticated = await Auth.guard<any>('web').attempt(fields)
    return authenticated ? authenticated.getUser() : null
  }, custom)

/** The local strategy's verify callback, through `PassportGuard.verifyLocal()`. */
const verifyLocal = (provider: unknown, username: any, password: any, custom: Record<string, unknown> = {}) =>
  new Promise<{ err: any; user: any; info?: any }>((resolve) => {
    let verify: any
    class FakeStrategy {
      constructor(_options: Record<string, unknown>, callback: any) {
        verify = callback
      }
    }
    const guard = new PassportGuard('web', { ...configOf(provider, custom).guards.web, strategy: FakeStrategy as any } as any)
    guard.register({ use: () => {} } as any, undefined)
    verify(username, password, (err: any, user: any, info?: any) => resolve({ err, user, info }))
  })

describe('TokenGuard.attempt()', () => {
  it('finds the user by the other fields and checks the password with Hash.check()', async () => {
    const { User, calls } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    const user = await attempt(User, { email: 'ada@example.com', password: 'secret' })
    expect(user).toEqual({ id: 1, email: 'ada@example.com' })
    // { select: false }: the password is not a key at all, not a key set to undefined
    expect(Object.hasOwn(user as object, 'password')).toBe(false)
    expect(calls.where).toEqual([{ email: 'ada@example.com' }])
    expect(calls.addSelect).toEqual(['user.password'])
    expect(calls.update).toEqual([])
  })

  it('never puts the plain password in the lookup', async () => {
    const { User, calls } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    expect(await attempt(User, { email: 'ada@example.com', password: 'secret' })).not.toBeNull()
    const parameters = JSON.stringify(calls.where)
    expect(parameters).not.toContain('secret')
    expect(calls.where).toEqual([{ email: 'ada@example.com' }])
  })

  it('refuses a wrong password and an unknown user', async () => {
    const { User } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    expect(await attempt(User, { email: 'ada@example.com', password: 'wrong' })).toBeNull()
    expect(await attempt(User, { email: 'bob@example.com', password: 'secret' })).toBeNull()
  })

  it('runs one check against the dummy hash when the user is unknown', async () => {
    const { User, calls } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    const check = vi.spyOn(Hash, 'check')
    expect(await attempt(User, { email: 'bob@example.com', password: 'secret' })).toBeNull()
    expect(check).toHaveBeenCalledTimes(1)
    expect(Hash.isHashed(check.mock.calls[0]![1])).toBe(true)
    expect(calls.update).toEqual([])
    check.mockRestore()
  })

  it('keeps the password on the user when the column is selectable, as a plain lookup does', async () => {
    const hashed = Hash.make('secret')
    const { User, calls } = fakeModel([{ id: 1, email: 'ada@example.com', password: hashed }], { select: true })
    expect(await attempt(User, { email: 'ada@example.com', password: 'secret' })).toEqual({
      id: 1,
      email: 'ada@example.com',
      password: hashed,
    })
    expect(calls.update).toEqual([])
  })

  it('logs in a 0.5 sha256 user once and replaces the hash with a scrypt one', async () => {
    const rows = [{ id: 7, email: 'old@example.com', password: SHA256_SECRET }]
    const { User, calls } = fakeModel(rows)
    expect(await attempt(User, { email: 'old@example.com', password: 'secret' })).toEqual({ id: 7, email: 'old@example.com' })
    expect(calls.update).toHaveLength(1)
    expect(Hash.isHashed(rows[0]!.password)).toBe(true)
    expect(Hash.check('secret', rows[0]!.password)).toBe(true)

    expect(await attempt(User, { email: 'old@example.com', password: 'secret' })).not.toBeNull()
    expect(calls.update).toHaveLength(1)
  })

  it('does not rehash on a failed login', async () => {
    const { User, calls } = fakeModel([{ id: 7, email: 'old@example.com', password: SHA256_SECRET }])
    expect(await attempt(User, { email: 'old@example.com', password: 'wrong' })).toBeNull()
    expect(calls.update).toEqual([])
  })

  it('returns the new hash when it rehashes a selectable password column', async () => {
    const rows = [{ id: 7, email: 'old@example.com', password: SHA256_SECRET }]
    const { User, calls } = fakeModel(rows, { select: true })
    const user: any = await attempt(User, { email: 'old@example.com', password: 'secret' })
    expect(calls.update).toHaveLength(1)
    expect(user.password).toBe(rows[0]!.password)
    expect(Hash.isHashed(user.password)).toBe(true)
    expect(Hash.check('secret', user.password)).toBe(true)
  })

  it('logs in when the rehash update fails: the stored hash still verifies', async () => {
    const rows = [{ id: 7, email: 'old@example.com', password: SHA256_SECRET }]
    const { User, calls } = fakeModel(rows, { failUpdate: true })
    expect(await attempt(User, { email: 'old@example.com', password: 'secret' })).toEqual({ id: 7, email: 'old@example.com' })
    expect(calls.update).toHaveLength(1)
    expect(rows[0]!.password).toBe(SHA256_SECRET)
  })

  it('never queries without a password or a lookup field', async () => {
    const { User, calls, builders, findOneBy } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    expect(await attempt(User, { email: 'ada@example.com' })).toBeNull()
    expect(await attempt(User, { password: 'secret' })).toBeNull()
    expect(await attempt(User, { email: undefined, password: 'secret' })).toBeNull()
    expect(calls.where).toEqual([])
    expect(builders).not.toHaveBeenCalled()
    expect(findOneBy).not.toHaveBeenCalled()
  })

  it('refuses a username that is not a string before any query', async () => {
    const { User, calls, builders, findOneBy } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    for (const email of [{ $ne: null }, ['ada@example.com'], 42, null, true]) {
      expect(await attempt(User, { email, password: 'secret' })).toBeNull()
    }
    expect(calls.where).toEqual([])
    expect(builders).not.toHaveBeenCalled()
    expect(findOneBy).not.toHaveBeenCalled()
  })

  it('refuses a password that is not a string before any query', async () => {
    const { User, calls, builders, findOneBy } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    for (const password of [{ $ne: null }, ['secret'], 42, null, true]) {
      expect(await attempt(User, { email: 'ada@example.com', password })).toBeNull()
    }
    expect(calls.where).toEqual([])
    expect(builders).not.toHaveBeenCalled()
    expect(findOneBy).not.toHaveBeenCalled()
  })

  it('logs in through a guard passwordField that is not "password"', async () => {
    const { User, calls } = fakeModel([{ id: 1, email: 'ada@example.com', pass: Hash.make('secret') }], { column: 'pass' })
    const user = await attempt(User, { email: 'ada@example.com', pass: 'secret' }, { passwordField: 'pass' })
    expect(user).toEqual({ id: 1, email: 'ada@example.com' })
    expect(calls.where).toEqual([{ email: 'ada@example.com' }])
    expect(calls.addSelect).toEqual(['user.pass'])
  })

  it('throws when the provider model has no column for the guard passwordField', async () => {
    const { User, calls } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    await expect(attempt(User, { email: 'ada@example.com', pass: 'secret' }, { passwordField: 'pass' })).rejects.toThrow(
      '[@laratype/auth] User has no "pass" column (the guard\'s passwordField)',
    )
    expect(calls.where).toEqual([])
  })
})

describe('Auth.attempt()', () => {
  it('authenticates through the same check', async () => {
    const { User } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    await inApp(User, async () => {
      const authenticated = await new Auth().attempt<any>({ email: 'ada@example.com', password: 'secret' })
      expect(authenticated && authenticated.getUser()).toEqual({ id: 1, email: 'ada@example.com' })
      expect(await new Auth().attempt<any>({ email: 'ada@example.com', password: 'wrong' })).toBe(false)
    })
  })
})

describe('PassportGuard.verifyLocal()', () => {
  it('logs in through the local strategy with the schema fields as keys', async () => {
    const { User, calls } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    const { err, user } = await inApp(User, () => verifyLocal(User, 'ada@example.com', 'secret'))
    expect(err).toBeNull()
    expect(user).toEqual({ id: 1, email: 'ada@example.com' })
    expect(calls.where).toEqual([{ email: 'ada@example.com' }])
  })

  it('answers wrong credentials as a rejection, and a thrown error to cb(err)', async () => {
    const { User } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    const wrong = await inApp(User, () => verifyLocal(User, 'ada@example.com', 'wrong'))
    expect(wrong.err).toBeNull()
    expect(wrong.user).toBe(false)
    expect(wrong.info).toEqual({ message: 'Incorrect username or password.' })

    const { User: NoColumn } = fakeModel([], { column: 'password' })
    const broken = await inApp(NoColumn, () => verifyLocal(NoColumn, 'ada@example.com', 'secret', { passwordField: 'pass' }))
    expect(broken.err).toBeInstanceOf(Error)
    expect((broken.err as Error).message).toContain('has no "pass" column')
    expect(broken.user).toBe(false)
  })

  it('refuses empty field names at boot', () => {
    const message = '[@laratype/auth] Auth guard "web": a local strategy needs options.usernameField and options.passwordField.'
    for (const custom of [{ usernameField: '' }, { passwordField: '' }]) {
      const { User } = fakeModel([])
      const guard = new PassportGuard('web', configOf(User, custom).guards.web as any)
      const use = vi.fn()
      expect(() => guard.register({ use } as any, undefined)).toThrow(message)
      expect(use).not.toHaveBeenCalled()
    }
  })
})
