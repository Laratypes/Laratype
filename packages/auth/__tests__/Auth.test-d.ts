// Type tests (D8 #115 + A4 #151): the `Auth` facade forwards to `AuthService`, which reads the guards.
import { describe, expectTypeOf, test } from 'vitest'
import type { Model } from '@laratype/database'
import { Auth, AuthService } from '../src'
import type { Authenticated } from '../src/verifications/AuthVerification'

declare const user: Model

describe('AuthService', () => {
  test('builds the 0.5 per-guard handles', () => {
    expectTypeOf(new AuthService().user<Model>()).toEqualTypeOf<Authenticated<Model> | null>()
    expectTypeOf(new AuthService().guard<Model>('web').attempt({})).toEqualTypeOf<Promise<false | Authenticated<Model>>>()
    expectTypeOf(new AuthService().guard('web').user()).toEqualTypeOf<Authenticated<Model> | undefined>()
    expectTypeOf(new AuthService().check()).toEqualTypeOf<boolean>()
  })
})

describe('Auth facade', () => {
  test('forwards its statics to the AuthService accessor', () => {
    expectTypeOf(Auth.accessor).toEqualTypeOf<typeof AuthService>()
    expectTypeOf(Auth.user<Model>()).toEqualTypeOf<Authenticated<Model> | null>()
    expectTypeOf(Auth.guard<Model>('web').attempt({})).toEqualTypeOf<Promise<false | Authenticated<Model>>>()
    expectTypeOf(Auth.guard<Model>('web').user()).toEqualTypeOf<Authenticated<Model> | undefined>()
    expectTypeOf(Auth.login(user)).toEqualTypeOf<Authenticated<Model>>()
    expectTypeOf(Auth.fake(new AuthService())).toEqualTypeOf<() => void>()
  })

  test('negatives', () => {
    // @ts-expect-error the accessor is AuthService, not a guard manager
    Auth.fake({})
    // @ts-expect-error a guard name is a string
    Auth.guard(1)
  })
})
