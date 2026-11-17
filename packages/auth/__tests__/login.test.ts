// The password is checked with Hash.checkAsync() after the lookup, never matched in the query
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { Model } from '@laratype/database'
import { Hash } from '@laratype/support'
import { Auth, PassportGuard } from '../src'
import { SHA256_SECRET, attempt, configOf, fakeModel, inApp, type Row } from './fixtures/login'

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
  it('finds the user by the other fields and checks the password with Hash.checkAsync()', async () => {
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

  // First unknown-user login of the file: the module-level dummy hash is still cold, so this pins its async build too
  it('runs one async check against the dummy hash when the user is unknown', async () => {
    const { User, calls } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    const check = vi.spyOn(Hash, 'checkAsync')
    const make = vi.spyOn(Hash, 'makeAsync')
    const syncCheck = vi.spyOn(Hash, 'check')
    const syncMake = vi.spyOn(Hash, 'make')
    expect(await attempt(User, { email: 'bob@example.com', password: 'secret' })).toBeNull()
    expect(check).toHaveBeenCalledTimes(1)
    expect(Hash.isHashed(check.mock.calls[0]![1])).toBe(true)
    expect(make).toHaveBeenCalledTimes(1)
    expect(make.mock.calls[0]).toEqual([''])
    expect(syncCheck).not.toHaveBeenCalled()
    expect(syncMake).not.toHaveBeenCalled()
    expect(calls.update).toEqual([])
    check.mockRestore()
    make.mockRestore()
    syncCheck.mockRestore()
    syncMake.mockRestore()
  })

  it('refuses a wrong password and an unknown user', async () => {
    const { User } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    expect(await attempt(User, { email: 'ada@example.com', password: 'wrong' })).toBeNull()
    expect(await attempt(User, { email: 'bob@example.com', password: 'secret' })).toBeNull()
  })

  it('leaves the event loop free while the password is checked', async () => {
    const { User } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    // The timer is scheduled first: with scrypt on the loop it can only run after attempt() settled
    const tick = new Promise((resolve) => setTimeout(resolve, 0))
    let settled = false
    const login = attempt(User, { email: 'ada@example.com', password: 'secret' }).finally(() => {
      settled = true
    })
    await tick
    expect(settled).toBe(false)
    await expect(login).resolves.toEqual({ id: 1, email: 'ada@example.com' })
  })

  it('checks and rehashes through the async Hasher methods only', async () => {
    const rows = [{ id: 7, email: 'old@example.com', password: SHA256_SECRET }]
    const { User, calls } = fakeModel(rows)
    const check = vi.spyOn(Hash, 'checkAsync')
    const make = vi.spyOn(Hash, 'makeAsync')
    const syncCheck = vi.spyOn(Hash, 'check')
    const syncMake = vi.spyOn(Hash, 'make')
    expect(await attempt(User, { email: 'old@example.com', password: 'secret' })).toEqual({ id: 7, email: 'old@example.com' })
    // The legacy hash pays the dummy check first, then the real check reads the stored hash
    expect(check).toHaveBeenCalledTimes(2)
    expect(Hash.isHashed(check.mock.calls[0]![1])).toBe(true)
    expect(check.mock.calls[1]![1]).toBe(SHA256_SECRET)
    // The dummy hash may already be cached by an earlier test; the new hash for this user is always derived
    expect(make.mock.calls).toContainEqual(['secret'])
    expect(syncCheck).not.toHaveBeenCalled()
    expect(syncMake).not.toHaveBeenCalled()
    expect(calls.update).toHaveLength(1)
    expect(Hash.isHashed(rows[0]!.password)).toBe(true)
    check.mockRestore()
    make.mockRestore()
    syncCheck.mockRestore()
    syncMake.mockRestore()
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

  it('keeps a hash changed between the check and the rehash, and still logs in', async () => {
    const newer = Hash.make('newer')
    const rows = [{ id: 7, email: 'old@example.com', password: SHA256_SECRET }]
    const { User, calls } = fakeModel(rows, {
      select: true,
      beforeUpdate: () => {
        rows[0]!.password = newer
      },
    })
    const user: any = await attempt(User, { email: 'old@example.com', password: 'secret' })
    expect(user).not.toBeNull()
    expect(calls.update).toHaveLength(1)
    // The update names the hash that was checked, so it cannot match the newer one
    expect(calls.update[0]![0]).toEqual({ id: 7, password: SHA256_SECRET })
    expect(rows[0]!.password).toBe(newer)
    // The response does not carry a rehash of the old password
    expect(user.password).toBe(SHA256_SECRET)
    expect(Hash.check('newer', rows[0]!.password)).toBe(true)
  })

  it('rehashes a composite-key user by its whole key, and only that row', async () => {
    // Two rows share the legacy hash; only the full key tells them apart, so a criteria over the first column alone
    // would either miss the row (an object value) or match both
    const rows = [
      { tenant: 1, id: 7, email: 'old@example.com', password: SHA256_SECRET },
      { tenant: 2, id: 7, email: 'other@example.com', password: SHA256_SECRET },
    ]
    const { User, calls } = fakeModel(rows, { primaryColumns: ['tenant', 'id'] })
    expect(await attempt(User, { email: 'old@example.com', password: 'secret' })).toEqual({
      tenant: 1,
      id: 7,
      email: 'old@example.com',
    })
    expect(calls.update).toHaveLength(1)
    // Every primary column names the row: getId() is { tenant, id }, which one column cannot hold
    expect(calls.update[0]![0]).toEqual({ tenant: 1, id: 7, password: SHA256_SECRET })
    expect(Hash.isHashed(rows[0]!.password)).toBe(true)
    expect(rows[1]!.password).toBe(SHA256_SECRET)
  })

  it('skips the rehash when the row is missing part of its composite key', async () => {
    const rows = [{ tenant: 1, id: 7, email: 'old@example.com', password: SHA256_SECRET }]
    // `region` is a primary column the row does not carry: no update may be sent without the whole key
    const { User, calls } = fakeModel(rows, { primaryColumns: ['region', 'id'] })
    expect(await attempt(User, { email: 'old@example.com', password: 'secret' })).not.toBeNull()
    expect(calls.update).toEqual([])
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

  it('refuses a lookup value that is not a string, a boolean or a finite number, before any query', async () => {
    const { User, calls, builders, findOneBy } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    for (const email of [{ $ne: null }, ['ada@example.com'], null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(await attempt(User, { email, password: 'secret' })).toBeNull()
    }
    expect(calls.where).toEqual([])
    expect(builders).not.toHaveBeenCalled()
    expect(findOneBy).not.toHaveBeenCalled()
  })

  it('takes a boolean or a finite number lookup value, as a 0.5 caller passes', async () => {
    const { User, calls } = fakeModel([{ id: 1, email: 'ada@example.com', isActive: true, password: Hash.make('secret') }])
    expect(await attempt(User, { email: 'ada@example.com', isActive: true, password: 'secret' })).toEqual({
      id: 1,
      email: 'ada@example.com',
      isActive: true,
    })
    expect(calls.where).toEqual([{ email: 'ada@example.com', isActive: true }])

    const { User: ById, calls: idCalls } = fakeModel([{ id: 7, email: 'ada@example.com', password: Hash.make('secret') }])
    expect(await attempt(ById, { id: 7, password: 'secret' })).toEqual({ id: 7, email: 'ada@example.com' })
    expect(idCalls.where).toEqual([{ id: 7 }])
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
    const { User, calls } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }], { declared: 'pass' })
    await expect(attempt(User, { email: 'ada@example.com', pass: 'secret' }, { passwordField: 'pass' })).rejects.toThrow(
      '[@laratype/auth] User has no "pass" column (the guard\'s passwordField)',
    )
    expect(calls.where).toEqual([])
  })

  it('refuses a guard passwordField that is not the model credential column, before any query', async () => {
    const { User, calls, builders } = fakeModel([{ id: 1, email: 'ada@example.com', password: Hash.make('secret') }])
    await expect(attempt(User, { email: 'ada@example.com', pass: 'secret' }, { passwordField: 'pass' })).rejects.toThrow(
      '[@laratype/auth] User hashes "password", not the guard\'s passwordField "pass": set static passwordField on the model, or use the same name in options.',
    )
    expect(calls.where).toEqual([])
    expect(builders).not.toHaveBeenCalled()
  })
})

describe('a custom password column end to end', () => {
  /** A real Model whose save() feeds the rows attempt() reads, so the cast and the login meet. */
  const account = () => {
    const rows: Row[] = []
    class Account extends Model {
      id!: number
      email!: string
      pass!: string
      static override readonly fillable = ['email', 'pass']
      static override readonly passwordField = 'pass'
    }
    Object.assign(Account, {
      getRepository: () => ({
        metadata: {
          primaryColumns: [{ propertyName: 'id' }],
          findColumnWithPropertyName: (name: string) => (name === 'pass' ? { propertyPath: 'pass', isSelect: false } : undefined),
        },
        save: async (data: Row) => {
          const row = { id: rows.length + 1, ...data }
          rows.push(row)
          return row
        },
        update: async (criteria: Record<string, unknown>, data: Partial<Row>) => {
          const row = rows.find((candidate) => Object.entries(criteria).every(([key, value]) => candidate[key] === value))
          if (!row) return { affected: 0 }
          Object.assign(row, data)
          return { affected: 1 }
        },
      }),
      createQueryBuilder: () => {
        let where: Record<string, unknown> = {}
        const query = {
          where(value: Record<string, unknown>) {
            where = value
            return query
          },
          addSelect() {
            return query
          },
          getOne: async () => {
            const row = rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value))
            return row ? Object.assign(new Account(), row) : null
          },
        }
        return query
      },
    })
    return { Account, rows }
  }

  it('hashes the declared column on save() and logs in through attempt()', async () => {
    const { Account, rows } = account()
    await Account.save({ email: 'ada@example.com', pass: 'secret' })
    expect(Hash.isHashed(rows[0]!.pass)).toBe(true)
    expect(Hash.check('secret', rows[0]!.pass)).toBe(true)

    expect(await attempt(Account, { email: 'ada@example.com', pass: 'secret' }, { passwordField: 'pass' })).toEqual({
      id: 1,
      email: 'ada@example.com',
    })
    expect(await attempt(Account, { email: 'ada@example.com', pass: 'wrong' }, { passwordField: 'pass' })).toBeNull()
  })

  it('checks the column the model declares when the guard sets no passwordField', async () => {
    const { Account } = account()
    await Account.save({ email: 'ada@example.com', pass: 'secret' })
    expect(await attempt(Account, { email: 'ada@example.com', pass: 'secret' }, { passwordField: undefined })).toEqual({
      id: 1,
      email: 'ada@example.com',
    })
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

    const { User: NoColumn } = fakeModel([], { declared: 'pass' })
    const broken = await inApp(NoColumn, () => verifyLocal(NoColumn, 'ada@example.com', 'secret', { passwordField: 'pass' }))
    expect(broken.err).toBeInstanceOf(Error)
    expect((broken.err as Error).message).toContain('has no "pass" column')
    expect(broken.user).toBe(false)
  })

  it('refuses empty field names, or the same name twice, at boot', () => {
    const message = '[@laratype/auth] Auth guard "web": a local strategy needs options.usernameField and options.passwordField.'
    for (const custom of [{ usernameField: '' }, { passwordField: '' }]) {
      const { User } = fakeModel([])
      const guard = new PassportGuard('web', configOf(User, custom).guards.web as any)
      const use = vi.fn()
      expect(() => guard.register({ use } as any, undefined)).toThrow(message)
      expect(use).not.toHaveBeenCalled()
    }

    // options() has usernameField 'email'; with the password in the same field attempt() would drop the only lookup field
    const { User } = fakeModel([])
    const guard = new PassportGuard('web', configOf(User, { passwordField: 'email' }).guards.web as any)
    const use = vi.fn()
    expect(() => guard.register({ use } as any, undefined)).toThrow(
      '[@laratype/auth] Auth guard "web": options.usernameField and options.passwordField must be different fields.',
    )
    expect(use).not.toHaveBeenCalled()
  })
})
