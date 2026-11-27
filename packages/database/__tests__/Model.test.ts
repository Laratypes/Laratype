// A8 #350: every credential written through Model is hashed asynchronously, a request value can never be stored as a
// hash, only Hash.trusted() keeps a pre-hashed value, and findOneBy() refuses the credential column in every where form
import 'reflect-metadata'
import crypto from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hash } from '@laratype/support'
import Model from '../src/eloquent/Model'

type Row = Record<string, any>

/** The slice of a typeorm repository the Model statics reach, over arrays in memory, so the test needs no database. */
const model = () => {
  const saved: Row[] = []
  const updates: [unknown, Row][] = []
  const lookups: Row[] = []
  class User extends Model {
    id!: number
    email!: string
    password!: string
    static override readonly fillable = ['email', 'password']
  }
  (User as any).getRepository = () => ({
    save: async (data: Row | Row[]) => {
      saved.push(...(Array.isArray(data) ? data : [data]))
      return data
    },
    update: async (criteria: unknown, data: Row) => {
      updates.push([criteria, data])
    },
    findOneBy: async (where: Row) => {
      lookups.push(where)
      return null
    },
  })
  return { User, saved, updates, lookups }
}

describe('Model password cast', () => {
  afterEach(() => vi.restoreAllMocks())

  it('hashes a plain password on save()', async () => {
    const { User, saved } = model()
    await User.save({ email: 'ada@example.com', password: 'secret' })
    expect(saved[0]!.password).toMatch(/^\$scrypt\$N=16384,r=8,p=1\$/)
    expect(Hash.check('secret', saved[0]!.password)).toBe(true)
  })

  it('hashes a hash-shaped password: request input never chooses the stored hash', async () => {
    const { User, saved } = model()
    // A client can submit a well-formed scrypt string; it must be the password, not the credential
    const submitted = Hash.make('chosen')
    await User.save({ email: 'ada@example.com', password: submitted })
    const stored = saved[0]!.password
    expect(stored).not.toBe(submitted)
    expect(Hash.isHashed(stored)).toBe(true)
    expect(Hash.check(submitted, stored)).toBe(true)
    expect(Hash.check('chosen', stored)).toBe(false)
  })

  it('hashes a hash-shaped password on update() and updateFor()', async () => {
    const { User, updates } = model()
    const submitted = Hash.make('chosen')
    await User.update({ email: 'ada@example.com' }, { password: submitted })
    const updated = updates[0]![1].password
    expect(updated).not.toBe(submitted)
    expect(Hash.check(submitted, updated)).toBe(true)

    const row: any = Object.assign(new User(), { id: 1, email: 'ada@example.com', password: 'old' })
    row.save = async () => row
    await User.updateFor(row, { password: submitted })
    expect(row.password).not.toBe(submitted)
    expect(Hash.check(submitted, row.password)).toBe(true)
  })

  it('stores a Hash.trusted() value as it is, and only for the credential column', async () => {
    const { User, saved, updates } = model()
    const hashed = Hash.make('seed')
    await User.save({ email: 'ada@example.com', password: Hash.trusted(hashed) })
    expect(saved[0]!.password).toBe(hashed)
    expect(Hash.check('seed', saved[0]!.password)).toBe(true)

    await User.update({ email: 'ada@example.com' }, { password: Hash.trusted(hashed) })
    expect(updates[0]![1].password).toBe(hashed)

    const row: any = Object.assign(new User(), { id: 1, email: 'ada@example.com', password: 'old' })
    row.save = async () => row
    await User.updateFor(row, { password: Hash.trusted(hashed) })
    expect(row.password).toBe(hashed)

    await expect(
      User.save({ email: Hash.trusted(hashed) as any, password: 'secret' }),
    ).rejects.toThrow('Hash.trusted() is only for the "password" column, not "email"')
    expect(saved).toHaveLength(1)
  })

  it('hashes a foreign-cost $scrypt$ value as a plain password', async () => {
    const { User, saved } = model()
    const [, , , salt, key] = Hash.make('secret').split('$')
    const value = `$scrypt$N=32768,r=8,p=1$${salt}$${key}`
    await User.save({ email: 'ada@example.com', password: value })
    expect(saved[0]!.password).not.toBe(value)
    expect(Hash.check(value, saved[0]!.password)).toBe(true)
  })

  it('refuses the credential column in the object, array and nested findOneBy() forms', async () => {
    const { User, lookups } = model()
    const message = 'findOneBy() cannot look a user up by password'
    for (const where of [
      { email: 'ada@example.com', password: 'secret' },
      [{ email: 'ada@example.com' }, { password: 'secret' }],
      { user: { email: 'ada@example.com', password: 'secret' } },
      [{ user: { password: 'secret' } }],
      { email: 'ada@example.com', password: undefined },
      // JSON.parse() makes __proto__ an own data key, and its object is walked like any other nested where
      JSON.parse('{"__proto__":{"password":"secret"}}'),
    ]) {
      await expect(User.findOneBy(where as any)).rejects.toThrow(message)
    }
    // A non-enumerable own password key is refused too
    const hidden: any = { email: 'ada@example.com' }
    Object.defineProperty(hidden, 'password', { value: 'secret', enumerable: false })
    await expect(User.findOneBy(hidden)).rejects.toThrow(message)
    expect(lookups).toEqual([])
  })

  it('refuses a credential key on a class instance, at the top level and inside an array', async () => {
    const { User, lookups } = model()
    class Where {
      email = 'ada@example.com'
      password = 'secret'
    }
    const message = 'findOneBy() cannot look a user up by password'
    await expect(User.findOneBy(new Where() as any)).rejects.toThrow(message)
    await expect(User.findOneBy([new Where()] as any)).rejects.toThrow(message)
    expect(lookups).toEqual([])
  })

  it('refuses a credential key nested in a class-instance where container', async () => {
    const { User, lookups } = model()
    // TypeORM's buildWhere() reads a class instance's own fields with for...in, so the nested password reaches the SQL
    class Criteria {
      user = { email: 'ada@example.com', password: 'secret' }
    }
    await expect(User.findOneBy(new Criteria() as any)).rejects.toThrow('findOneBy() cannot look a user up by password')
    expect(lookups).toEqual([])
  })

  it('allows a relation lookup by a loaded entity that carries its password hash', async () => {
    const { User, lookups } = model()
    class Author extends Model {
      id!: number
      email!: string
      password!: string
    }
    const author: any = Object.assign(new Author(), {
      id: 1,
      email: 'ada@example.com',
      password: Hash.make('loaded'),
    })
    // { author } is a relation lookup by that row: TypeORM compares author.password with the stored hash, so it matches
    await expect(User.findOneBy({ author } as any)).resolves.toBeNull()
    expect(lookups).toEqual([{ author }])
  })

  it('still refuses a loaded entity passed as the top-level where', async () => {
    const { User, lookups } = model()
    const loaded: any = Object.assign(new User(), { id: 1, email: 'ada@example.com', password: 'stored-hash' })
    await expect(User.findOneBy(loaded)).rejects.toThrow('findOneBy() cannot look a user up by password')
    expect(lookups).toEqual([])
  })

  it('queries a nested or cyclic where that does not carry the password', async () => {
    const { User, lookups } = model()
    await expect(User.findOneBy({ user: { email: 'ada@example.com' } } as any)).resolves.toBeNull()
    const cyclic: any = { email: 'ada@example.com' }
    cyclic.self = cyclic
    await expect(User.findOneBy(cyclic)).resolves.toBeNull()
    expect(lookups).toHaveLength(2)
    expect(lookups[0]).toEqual({ user: { email: 'ada@example.com' } })
    expect(lookups[1]).toBe(cyclic)
  })

  it('does not walk a non-plain where value, such as a large Buffer', async () => {
    const { User, lookups } = model()
    await expect(User.findOneBy({ email: Buffer.alloc(1024 * 1024) } as any)).resolves.toBeNull()
    expect(lookups).toHaveLength(1)
  })

  it('refuses a non-string credential before the repository, with no partial write', async () => {
    const { User, saved, updates } = model()
    for (const value of [{}, 1, null, undefined, NaN, Infinity, { length: 1e9 }, [], Buffer.from('x')]) {
      await expect(User.save({ email: 'ada@example.com', password: value as any }))
        .rejects.toThrow('[@laratype/database] User credential cast: "password" takes a string or Hash.trusted(hash)')
    }
    await expect(User.update({ email: 'ada@example.com' }, { password: 1 as any }))
      .rejects.toThrow('credential cast')
    const row: any = Object.assign(new User(), { id: 1, email: 'ada@example.com', password: 'old' })
    row.save = async () => row
    await expect(User.updateFor(row, { password: 1 as any })).rejects.toThrow('credential cast')
    expect(saved).toEqual([])
    expect(updates).toEqual([])
    expect(row.password).toBe('old')
  })

  it('hashes an array sequentially and writes nothing when one item fails', async () => {
    const { User, saved } = model()
    const makeAsync = vi.spyOn(Hash, 'makeAsync')
    let active = 0
    let most = 0
    makeAsync.mockImplementation(async (value: string) => {
      active += 1
      most = Math.max(most, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
      return `hashed:${value}`
    })
    await User.save([
      { email: 'a@example.com', password: 'a' },
      { email: 'b@example.com', password: 'b' },
      { email: 'c@example.com', password: 'c' },
    ])
    expect(most).toBe(1)
    expect(saved.map((row) => row.password)).toEqual(['hashed:a', 'hashed:b', 'hashed:c'])

    saved.length = 0
    await expect(User.save([{ email: 'd@example.com', password: 'd' }, { email: 'e@example.com', password: 1 as any }]))
      .rejects.toThrow('credential cast')
    expect(saved).toEqual([])
  })

  it('hashes save(), update() and updateFor() off the event loop', async () => {
    const { User } = model()
    const syncScrypt = vi.spyOn(crypto, 'scryptSync')
    const syncMake = vi.spyOn(Hash, 'make')
    const makeAsync = vi.spyOn(Hash, 'makeAsync')
    const tick = new Promise((resolve) => setTimeout(resolve, 0))
    let settled = false
    const saving = User.save({ email: 'ada@example.com', password: 'secret' }).finally(() => {
      settled = true
    })
    await tick
    expect(settled).toBe(false)
    await saving
    await User.update({ email: 'ada@example.com' }, { password: 'secret' })
    const row: any = Object.assign(new User(), { id: 1, email: 'ada@example.com', password: 'old' })
    row.save = async () => row
    await User.updateFor(row, { password: 'secret' })
    expect(makeAsync).toHaveBeenCalledTimes(3)
    expect(syncScrypt).not.toHaveBeenCalled()
    expect(syncMake).not.toHaveBeenCalled()
  })

  it('hashes empty, very long, unicode and control-character passwords', async () => {
    const { User, saved } = model()
    const values = ['', 'a'.repeat(1024 * 1024), 'pässwörd', '\u0000\u0001', '\uD800']
    for (const value of values) {
      await User.save({ email: 'edge@example.com', password: value })
    }
    for (const [index, value] of values.entries()) {
      expect(Hash.check(value, saved[index]!.password)).toBe(true)
    }
  })

  it('casts only the fillable enumerable keys: __proto__ and a hidden password never reach the credential', async () => {
    const { User, saved } = model()
    // JSON.parse() makes __proto__ an own data key; it is not fillable, so it is dropped (and no prototype is polluted)
    await User.save(JSON.parse('{"email":"ada@example.com","password":"secret","__proto__":{"password":"evil"}}'))
    expect(Hash.check('secret', saved[0]!.password)).toBe(true)
    expect(({} as any).password).toBeUndefined()

    const hidden = { email: 'hidden@example.com' }
    Object.defineProperty(hidden, 'password', { value: 'secret', enumerable: false })
    await User.save(hidden)
    expect(saved[1]!.password).toBeUndefined()
  })

  it('hashes and refuses the credential column a model declares with static passwordField', async () => {
    const { User, saved, lookups } = model()
    class Account extends Model {
      id!: number
      email!: string
      pass!: string
      static override readonly fillable = ['email', 'pass']
      static override readonly passwordField = 'pass'
    }
    ;(Account as any).getRepository = (User as any).getRepository

    await Account.save({ email: 'ada@example.com', pass: 'secret' })
    expect(saved[0]!.pass).toMatch(/^\$scrypt\$N=16384,r=8,p=1\$/)
    expect(saved[0]!.password).toBeUndefined()
    expect(Hash.check('secret', saved[0]!.pass)).toBe(true)

    const hashed = Hash.make('seed')
    await Account.save({ email: 'seed@example.com', pass: Hash.trusted(hashed) })
    expect(saved[1]!.pass).toBe(hashed)

    for (const where of [
      { email: 'ada@example.com', pass: 'secret' },
      [{ email: 'ada@example.com' }, { pass: 'secret' }],
      { user: { pass: 'secret' } },
    ]) {
      await expect(Account.findOneBy(where as any)).rejects.toThrow('findOneBy() cannot look a user up by password')
    }
    await expect(Account.findOneBy({ email: 'ada@example.com', password: 'secret' })).resolves.toBeNull()
    expect(lookups).toEqual([{ email: 'ada@example.com', password: 'secret' }])
  })
})
