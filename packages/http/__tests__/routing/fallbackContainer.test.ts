// D9 #270: the autowire-only fallback container warns once in dev, never in production
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import Controller from '../../src/controller/Controller'
import RequestKernel from '../../src/request/Request'

const FALLBACK_WARNED = Symbol.for('laratype.http.fallbackContainerWarned')

/**
 * A fresh copy of the module that declares the fallback container, so each load starts without one.
 * `Request` is the module that holds the fallback: the http entry would evaluate every http module for the same state.
 * The static import above pays the one-time cost of transforming the graph and loading it for the first time during
 * collection, outside the test timeout: that first import took ~1.7 s idle and up to ~5 s under CPU load, while a copy
 * loaded after it takes ~0.1 s (H40 #333). A load still re-evaluates the graph, so `resetModules()` keeps copies apart.
 */
const loadFreshKernel = async () => {
  vi.resetModules()
  const { default: FreshRequestKernel } = await import('../../src/request/Request')
  return FreshRequestKernel
}

const clearWarned = () => { delete (globalThis as { [FALLBACK_WARNED]?: true })[FALLBACK_WARNED] }

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  clearWarned()
  vi.stubGlobal('__PROD__', false)
  vi.stubEnv('NODE_ENV', 'development')
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  clearWarned()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('fallback container', () => {
  it('warns once in dev, also across module copies', async () => {
    const kernel = await loadFreshKernel()
    const fallback = kernel.container()
    expect(kernel.container()).toBe(fallback)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toMatchInlineSnapshot(`"[@laratype/http] No app container outside a RequestKernel request, so controllers (and RequestKernel.container()) use an autowire-only container: app bindings don't apply, and every request shares the singletons it autowires. Serve routes through RequestKernel to resolve them from the app container."`)
    const secondKernel = await loadFreshKernel()
    expect(secondKernel.container()).not.toBe(fallback)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('never warns when __PROD__ is set', async () => {
    vi.stubGlobal('__PROD__', true)
    const kernel = await loadFreshKernel()
    kernel.container()
    kernel.container()
    expect(warn).not.toHaveBeenCalled()
  })

  it('an explicit __PROD__ = false wins over NODE_ENV=production', async () => {
    vi.stubGlobal('__PROD__', false)
    vi.stubEnv('NODE_ENV', 'production')
    const kernel = await loadFreshKernel()
    kernel.container()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('never warns when NODE_ENV is production', async () => {
    vi.stubGlobal('__PROD__', undefined)
    vi.stubEnv('NODE_ENV', 'production')
    const kernel = await loadFreshKernel()
    kernel.container()
    expect(warn).not.toHaveBeenCalled()
  })

  it('never warns for a request served through RequestKernel', async () => {
    // The copies evaluated at collection: tests 1-4 reset the module registry, so only these static bindings still
    // point at the same core and support modules, and HTTP_APP is a token instance whose identity is per module copy
    const container = new Container({ deps: depsRegistry })
    const app = new Hono()
    container.instance(HTTP_APP, app)
    new RequestKernel(container).boot()
    class Probe extends Controller {
      index() { return {} }
    }
    app.get('/probe', RequestKernel.handle({ method: 'get', path: '/probe', controller: [Probe, 'index'] }))
    expect((await app.request('/probe')).status).toBe(200)
    expect(warn).not.toHaveBeenCalled()
  })
})
