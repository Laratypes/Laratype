// D8 #115: Auth is a facade over the container binding of AuthManager
import 'reflect-metadata'
import { afterEach, describe, expect, it } from 'vitest'
import { Container, Facade } from '@laratype/core'
import { ContextApi } from '@laratype/support'
import { Auth, AuthManager } from '../src'

/** Answers every call with a marker instead of reading the guards. */
class FakeAuth extends AuthManager {
  override user<T>() {
    return 'fake user' as T
  }
  override check() {
    return true
  }
}

describe('Auth facade', () => {
  afterEach(() => Facade.setFacadeApplication(undefined))

  it('forwards to AuthManager by default, as in 0.5', () => {
    expect(Auth.user()).toBeNull()
    expect(() => Auth.check()).toThrow('Method not implemented.')
    ContextApi.run({ user: undefined } as any, () => {
      expect(Auth.guard('web').user()).toBeUndefined()
    })
  })

  it('app.swap() replaces the implementation', () => {
    const app = new Container()
    Facade.setFacadeApplication(app)
    const restore = app.swap(AuthManager, new FakeAuth())
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
