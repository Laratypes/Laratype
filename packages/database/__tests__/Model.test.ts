// A password value is hashed once on save/update, a stored make() hash is kept, and findOneBy() refuses a password key
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
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
  it('hashes a plain password on save()', async () => {
    const { User, saved } = model()
    await User.save({ email: 'ada@example.com', password: 'secret' })
    expect(saved[0]!.password).toMatch(/^\$scrypt\$N=16384,r=8,p=1\$/)
    expect(Hash.check('secret', saved[0]!.password)).toBe(true)
  })

  it('stores a value from Hash.make() as it is: the UserFactory definition is not hashed again', async () => {
    const { User, saved } = model()
    const hashed = Hash.make('password')
    await User.save({ email: 'ada@example.com', password: hashed })
    expect(saved[0]!.password).toBe(hashed)
    expect(Hash.check('password', saved[0]!.password)).toBe(true)
  })

  it('hashes a plain password on update(), and keeps a hash', async () => {
    const { User, updates } = model()
    const hashed = Hash.make('secret')
    await User.update({ email: 'ada@example.com' }, { password: 'secret' })
    expect(Hash.check('secret', updates[0]![1].password)).toBe(true)
    await User.update({ email: 'ada@example.com' }, { password: hashed })
    expect(updates[1]![1].password).toBe(hashed)
  })

  it('hashes a $scrypt$ value at another cost as a plain password, since cast only keeps what make() writes', async () => {
    const { User, saved } = model()
    const [, , , salt, key] = Hash.make('secret').split('$')
    for (const N of [32768, 8192]) {
      const value = `$scrypt$N=${N},r=8,p=1$${salt}$${key}`
      await User.save({ email: `${N}@example.com`, password: value })
      const stored = saved.at(-1)!.password
      expect(stored).not.toBe(value)
      expect(Hash.isHashed(stored)).toBe(true)
      expect(Hash.check(value, stored)).toBe(true)
    }
  })

  it('throws a findOneBy() that carries a password, instead of matching a plain password in the query', async () => {
    const { User, lookups } = model()
    expect(() => User.findOneBy({ email: 'ada@example.com', password: 'secret' })).toThrow(
      'findOneBy() cannot look a user up by password: look the user up without it, then check the password with Hash.check()',
    )
    expect(() => User.findOneBy({ email: 'ada@example.com', password: Hash.make('secret') })).toThrow()
    expect(lookups).toEqual([])
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

    expect(() => Account.findOneBy({ email: 'ada@example.com', pass: 'secret' })).toThrow(
      'findOneBy() cannot look a user up by password',
    )
    expect(() => Account.findOneBy({ email: 'ada@example.com', password: 'secret' })).not.toThrow()
    expect(lookups).toEqual([{ email: 'ada@example.com', password: 'secret' }])
  })
})
