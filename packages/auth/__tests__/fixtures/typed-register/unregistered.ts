// A1 #119: a program without the app's `declare module '@laratype/auth'` augmentation keeps the 0.5 types.
// Compiled by ../../typedRegister.test.ts, never run: the `types` program already registers the auth types.
import { expectTypeOf } from 'vitest'
import type { Model } from '@laratype/database'
import { Auth, AuthManager, AuthVerification } from '@laratype/auth'
import type { Authenticated } from '../../../src/verifications/AuthVerification'
import type { GuardName, RegisteredUser } from '@laratype/auth'

expectTypeOf(Auth.user()).toEqualTypeOf<Authenticated<Model> | null>()
expectTypeOf<RegisteredUser>().toEqualTypeOf<Model>()
expectTypeOf<GuardName>().toEqualTypeOf<string>()

// Any string is a guard name before the app registers its guards
Auth.guard('anything')
AuthVerification.guard('anything')
new AuthManager({ default: { guard: 'web' }, guards: {} }).guard('anything')
