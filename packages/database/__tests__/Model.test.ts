// A password value is hashed once on save/update, a stored hash is kept, and findOneBy() never hashes it
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

  it('passes a findOneBy() password through: a salted hash cannot be matched in the query', async () => {
    const { User, lookups } = model()
    const hashed = Hash.make('secret')
    await User.findOneBy({ email: 'ada@example.com', password: hashed })
    expect(lookups).toEqual([{ email: 'ada@example.com', password: hashed }])
  })
})
