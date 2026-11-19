// D11 #318: facades and ContextApi.getContainer() share one app-container lookup
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Container, Facade, Injectable } from '@laratype/core'
import { ContextApi, Hash, Hasher } from '@laratype/support'

/** A Hasher whose make() is replaced, for the shared-container tests. */
const replacing = (make: (value: string) => string) =>
  new (class extends Hasher {
    override make(value: string) {
      return make(value)
    }
  })()

/** An autowired singleton, to check the lookup shares autowired instances as well as bindings. */
@Injectable({ scope: 'singleton' })
class Shared {}

afterEach(() => {
  Facade.setFacadeApplication(undefined)
  vi.unstubAllGlobals()
})

describe('ContextApi.getContainer', () => {
  it('sees a Hash.fake() made outside a booted app, and the facade sees a binding made there', () => {
    vi.stubGlobal('__PROD__', true)
    const fake = replacing((value) => `fake:${value}`)
    const restore = Hash.fake(fake)
    const container = ContextApi.getContainer()
    expect(container).toBe(Facade.getFacadeApplication())
    expect(container?.make(Hasher)).toBe(fake)

    // The reverse: the controller-side lookup binds the accessor, and the facade resolves it
    const other = replacing((value) => `other:${value}`)
    container!.instance(Hasher, other)
    expect(Hash.make('secret')).toBe('other:secret')
    restore()
  })

  it('shares the autowired singletons of the fallback with the facades', () => {
    vi.stubGlobal('__PROD__', true)
    const fallback = Facade.getFacadeApplication()
    const fromContext = ContextApi.getContainer()!.make(Shared)
    expect(fromContext).toBeInstanceOf(Shared)
    expect(fallback.make(Shared)).toBe(fromContext)
  })

  it('prefers the request container over the app container', () => {
    const request = new Container()
    ContextApi.run({ container: request } as never, () => {
      expect(ContextApi.getContainer()).toBe(request)
    })
  })
})
