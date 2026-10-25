// Type tests (A4 #151): run by `bunx vitest run --project types`.
import { describe, expectTypeOf, test } from 'vitest'
import type { Strategy } from 'passport'
import { Container } from '@laratype/core'
import type { LaratypeConfig } from '@laratype/support'
import { AUTH_CONFIG, AuthManager, PassportGuard, TokenGuard } from '../src'
import type { GuardConfig } from '../src'

declare class User { id: number }
declare const strategy: typeof Strategy
declare const container: Container

describe('container bindings', () => {
  test('AUTH_CONFIG and AuthManager resolve typed', () => {
    expectTypeOf(container.make(AUTH_CONFIG)).toEqualTypeOf<LaratypeConfig.Auth>()
    expectTypeOf(container.make(AuthManager)).toEqualTypeOf<AuthManager>()
    expectTypeOf<GuardConfig>().toEqualTypeOf<LaratypeConfig.Auth['guards'][string]>()
  })

  test('negatives', () => {
    // @ts-expect-error AUTH_CONFIG takes the auth config
    container.instance(AUTH_CONFIG, { guards: {} })
    // @ts-expect-error AuthManager takes an AuthManager
    container.instance(AuthManager, {})
  })
})

describe('AuthManager.guard()', () => {
  const manager = new AuthManager({ default: { guard: 'web' }, guards: {} })

  test('returns a token guard typed by its user', () => {
    expectTypeOf(manager.guard()).toEqualTypeOf<TokenGuard<any>>()
    expectTypeOf(manager.guard<User>('admin')).toEqualTypeOf<TokenGuard<User>>()
    expectTypeOf(manager.guard<User>().verify).returns.toEqualTypeOf<Promise<User | false>>()
    expectTypeOf(manager.guard<User>().attempt).returns.toEqualTypeOf<Promise<User | null>>()
    expectTypeOf(manager.guard<User>().issueToken).parameter(0).toEqualTypeOf<User>()
    expectTypeOf(manager.defaultGuard).toEqualTypeOf<string>()
  })

  test('PassportGuard is a TokenGuard', () => {
    expectTypeOf<PassportGuard<User>>().toExtend<TokenGuard<User>>()
  })

  test('negatives', () => {
    // @ts-expect-error a guard name is a string
    manager.guard(1)
    // @ts-expect-error issueToken needs the token name and abilities
    manager.guard().issueToken({}, { expiresIn: 60 })
  })
})

describe('LaratypeConfig.Auth guards', () => {
  test('a guard has a strategy (PassportGuard) or not (TokenGuard)', () => {
    expectTypeOf({
      default: { guard: 'web' },
      guards: {
        web: { strategyName: 'local', strategy, options: { usernameField: 'email' }, provider: User, verification: 'jwt' },
        api: { provider: User, verification: 'jwt' },
      },
    } as const).toExtend<LaratypeConfig.Auth>()
  })

  test('negatives', () => {
    // @ts-expect-error verification is required
    const noVerification = { default: { guard: 'api' }, guards: { api: { provider: User } } } satisfies LaratypeConfig.Auth
    // @ts-expect-error verification is jwt or oauth2
    const badVerification = { default: { guard: 'api' }, guards: { api: { provider: User, verification: 'session' } } } satisfies LaratypeConfig.Auth
    void noVerification, badVerification
  })
})
