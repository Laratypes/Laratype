// D8 #115: Auth is a facade over the container binding of AuthService, which reads the guards (A4 #151)
import 'reflect-metadata'
import { afterEach, describe, expect, it } from 'vitest'
import { Container, Facade } from '@laratype/core'
import { ContextApi } from '@laratype/support'
import type { Model } from '@laratype/database'
import { Auth, AuthService, type Authenticated } from '../src'

/** Answers every call with a marker instead of reading the guards. */
class FakeAuth extends AuthService {
  override user<T extends Model>() {
    return 'fake user' as unknown as Authenticated<T>
  }
  override check() {
    return true
  }
}

describe('Auth facade', () => {
  afterEach(() => Facade.setFacadeApplication(undefined))

  it('forwards to AuthService by default, as in 0.5', () => {
    expect(Auth.user()).toBeNull()
    expect(() => Auth.check()).toThrow('Method not implemented.')
    ContextApi.run({ user: undefined } as any, () => {
      expect(Auth.guard('web').user()).toBeUndefined()
    })
  })

  it('app.swap() replaces the implementation', () => {
    const app = new Container()
    Facade.setFacadeApplication(app)
    const restore = app.swap(AuthService, new FakeAuth())
    expect(Auth.user()).toBe('fake user')
    expect(Auth.check()).toBe(true)
    restore()
    expect(Auth.user()).toBeNull()
  })

  it('Auth.fake() replaces the implementation', () => {
    const restore = Auth.fake(new FakeAuth())
    expect(Auth.user()).toBe('fake user')
    restore()
    expect(Auth.user()).toBeNull()
  })
})
