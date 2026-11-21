// D11 #318: ContextApi.getContainer() stays request-only until http's Request fallback moves onto the shared lookup
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Container, Facade } from '@laratype/core'
import { ContextApi, Hash, Hasher } from '@laratype/support'

/** A Hasher whose make() is replaced, for the fallback test. */
const replacing = (make: (value: string) => string) =>
  new (class extends Hasher {
    override make(value: string) {
      return make(value)
    }
  })()

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

  it('stays request-only outside a request, even when facades have a fallback', () => {
    vi.stubGlobal('__PROD__', true)
    const restore = Hash.fake(replacing((value) => `fake:${value}`))
    expect(Facade.getFacadeApplication()).toBeInstanceOf(Container)
    expect(Facade.hasFacadeApplication()).toBe(false)
    expect(ContextApi.getContainer()).toBeUndefined()
    restore()
  })
})
