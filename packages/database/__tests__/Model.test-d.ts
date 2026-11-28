// Type tests for the credential column a model declares (PR #346): static passwordField is a string, and the write
// methods take a Hash.trusted() value in the credential column (A8 #350)
import { describe, expectTypeOf, it } from 'vitest'
import type { UpdateResult } from 'typeorm'
import { Hash, type TrustedHash } from '@laratype/support'
import Model from '../src/eloquent/Model'

class User extends Model {
  id!: number
  email!: string
  password!: string
}

class Visits extends Model {
  id!: number
  visits!: number
}

describe('Model.passwordField types', () => {
  it('is a string, which a subclass overrides with its own column', () => {
    expectTypeOf(Model.passwordField).toEqualTypeOf<string>()

    class Account extends Model {
      static override readonly passwordField = 'pass'
    }
    expectTypeOf(Account.passwordField).toEqualTypeOf<string>()
  })
})

describe('Hash.trusted() in the Model write methods', () => {
  it('accepts a TrustedHash in the credential column of save(), update() and updateFor()', () => {
    const trusted: TrustedHash = Hash.trusted('hash')
    expectTypeOf(User.save({ email: 'ada@example.com', password: trusted })).toEqualTypeOf<Promise<User>>()
    expectTypeOf(User.save([{ email: 'ada@example.com', password: trusted }])).toEqualTypeOf<Promise<User[]>>()
    expectTypeOf(User.update({ email: 'ada@example.com' }, { password: trusted })).not.toBeAny()
    expectTypeOf(User.updateFor(new User(), { password: trusted })).toEqualTypeOf<Promise<User>>()
  })

  it('rejects an unbranded object in the credential column', () => {
    // @ts-expect-error an empty object is not a TrustedHash: DeepPartial must not make the brand optional
    void User.save({ email: 'ada@example.com', password: {} })
    // @ts-expect-error a bare { hash } is not a TrustedHash either
    void User.update({ email: 'ada@example.com' }, { password: { hash: 'x' } })
    // @ts-expect-error the rejection holds in the array form too
    void User.save([{ email: 'ada@example.com', password: {} }])
    // @ts-expect-error and in updateFor()
    void User.updateFor(new User(), { password: { hash: 'x' } })
  })

  it('keeps the QueryDeepPartialEntity expression form on update()', () => {
    expectTypeOf(Visits.update(1, { visits: () => 'visits + 1' })).toEqualTypeOf<Promise<UpdateResult>>()
  })
})
