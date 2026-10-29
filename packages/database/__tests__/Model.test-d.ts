// Type test for the credential column a model declares (PR #346): static passwordField is a string
import { describe, expectTypeOf, it } from 'vitest'
import Model from '../src/eloquent/Model'

describe('Model.passwordField types', () => {
  it('is a string, which a subclass overrides with its own column', () => {
    expectTypeOf(Model.passwordField).toEqualTypeOf<string>()

    class User extends Model {
      static override readonly passwordField = 'pass'
    }
    expectTypeOf(User.passwordField).toEqualTypeOf<string>()
  })
})
