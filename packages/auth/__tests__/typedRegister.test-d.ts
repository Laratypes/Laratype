// Type tests for the typed Register (A1 #119): run by `bunx vitest run --project types`.
import { describe, expectTypeOf, test } from 'vitest'
import { Model } from '@laratype/database'
import { Auth, AuthManager, AuthService, AuthVerification } from '../src'
import type { Authenticated } from '../src/verifications/AuthVerification'
import type { GuardName, RegisteredUser } from '../src'

class User extends Model {
  id!: number
}

// The app's registration: what `declare module` in app code looks like. It applies to the whole `types` program,
// so this is the only type test that registers the auth types.
declare module '@laratype/auth' {
  interface Register {
    user: User
    guards: {
      web: true
      api: true
      admin: true
    }
  }
}

describe('Register (A1 #119)', () => {
  test('reads the registered user and guard names', () => {
    expectTypeOf<RegisteredUser>().toEqualTypeOf<User>()
    expectTypeOf<GuardName>().toEqualTypeOf<'web' | 'api' | 'admin'>()
  })

  test('before a registration the 0.5 types stay', () => {
    expectTypeOf<RegisteredUser<{}>>().toEqualTypeOf<Model>()
    expectTypeOf<GuardName<{}>>().toEqualTypeOf<string>()
  })

  test('Auth.user() is typed by the registered user, with no type argument', () => {
    expectTypeOf(Auth.user()).toEqualTypeOf<Authenticated<User> | null>()
    expectTypeOf(new AuthService().user()).toEqualTypeOf<Authenticated<User> | null>()
    expectTypeOf(Auth.user<User>()).toEqualTypeOf<Authenticated<User> | null>()
  })

  test('the guard comes back with the registered user', () => {
    expectTypeOf(Auth.guard('web').user()).toEqualTypeOf<Authenticated<User> | undefined>()
    expectTypeOf(Auth.guard('web').attempt({})).toEqualTypeOf<Promise<false | Authenticated<User>>>()
    expectTypeOf(new AuthService().guard('web').user()).toEqualTypeOf<Authenticated<User> | undefined>()
  })

  test('login keeps the user it is given', () => {
    expectTypeOf(Auth.login(new User())).toEqualTypeOf<Authenticated<User>>()
  })

  test('negatives', () => {
    // @ts-expect-error the app registered web, api and admin
    Auth.guard('nope')
    // @ts-expect-error the app registered web, api and admin
    new AuthService().guard('nope')
    // @ts-expect-error the app registered web, api and admin
    AuthVerification.guard('nope')
    // @ts-expect-error the app registered web, api and admin
    new AuthManager({ default: { guard: 'web' }, guards: {} }).guard('nope')
  })
})
