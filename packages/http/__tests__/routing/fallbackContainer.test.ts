// D9 #270: the autowire-only fallback container warns once in dev, never in production
import { afterEach, describe, expect, it, vi } from 'vitest'

/** A fresh copy of the module, so each test starts without a fallback container. */
const loadRequest = async () => {
  vi.resetModules()
  return (await import('../../src/request/Request')).default
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('fallback container', () => {
  it('warns once in dev', async () => {
    vi.stubGlobal('__PROD__', false)
    vi.stubEnv('NODE_ENV', 'development')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const Request = await loadRequest()
    const fallback = Request.container()
    expect(Request.container()).toBe(fallback)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toMatchInlineSnapshot(`"[@laratype/http] Controllers are resolved without RequestKernel, by an autowire-only container: app bindings don't apply, and singletons it autowires live for the whole process. Boot RequestKernel to resolve them from the app container."`)
  })

  it('never warns when __PROD__ is set', async () => {
    vi.stubGlobal('__PROD__', true)
    vi.stubEnv('NODE_ENV', 'development')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const Request = await loadRequest()
    Request.container()
    Request.container()
    expect(warn).not.toHaveBeenCalled()
  })

  it('never warns when NODE_ENV is production', async () => {
    vi.stubGlobal('__PROD__', undefined)
    vi.stubEnv('NODE_ENV', 'production')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const Request = await loadRequest()
    Request.container()
    expect(warn).not.toHaveBeenCalled()
  })
})
