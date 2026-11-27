// D11 #318: ContextApi.getContainer() is the request scope, else the shared app container (appContainer())
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Container, Facade, token } from '@laratype/core'
import { ContextApi, Hash, Hasher } from '@laratype/support'

/** A Hasher whose make() is replaced, for the fallback test. */
const replacing = (make: (value: string) => string) =>
  new (class extends Hasher {
    override make(value: string) {
      return make(value)
    }
  })()

const NAME = token<string>('name')

afterEach(() => {
  Facade.setFacadeApplication(undefined)
  vi.unstubAllGlobals()
})

describe('ContextApi.getContainer', () => {
  it('is the request container inside a request', () => {
    const request = new Container()
    ContextApi.run({ container: request } as never, () => {
      expect(ContextApi.getContainer()).toBe(request)
    })
  })

  it('is the app container outside a request, so a facade fake applies to it', () => {
    vi.stubGlobal('__PROD__', true)
    const restore = Hash.fake(replacing((value) => `fake:${value}`))
    expect(ContextApi.getContainer()).toBe(Facade.getFacadeApplication())
    expect(ContextApi.getContainer().make(Hasher).make('secret')).toBe('fake:secret')
    restore()
  })

  it('prefers an app container set by setFacadeApplication()', () => {
    const app = new Container().instance(NAME, 'app')
    Facade.setFacadeApplication(app)
    expect(ContextApi.getContainer()).toBe(app)
    expect(ContextApi.getContainer().make(NAME)).toBe('app')
  })

  it('does not return a finished request container', () => {
    vi.stubGlobal('__PROD__', true)
    const request = new Container().instance(NAME, 'request')
    ContextApi.run({ container: request } as never, () => {
      expect(ContextApi.getContainer().make(NAME)).toBe('request')
    })
    const outside = ContextApi.getContainer()
    expect(outside).not.toBe(request)
    expect(outside.has(NAME)).toBe(false)
  })
})
