// D9 #270: the autowire-only fallback container warns once in dev, never in production
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

const FALLBACK_WARNED = Symbol.for('laratype.http.fallbackContainerWarned')

/** Fresh copies of the modules, so each test starts without a fallback container. */
const load = async () => {
  vi.resetModules()
  const [http, core, support] = await Promise.all([import('../../src/index'), import('@laratype/core'), import('@laratype/support')])
  return { ...http, ...core, ...support }
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  delete (globalThis as { [FALLBACK_WARNED]?: true })[FALLBACK_WARNED]
  vi.stubGlobal('__PROD__', false)
  vi.stubEnv('NODE_ENV', 'development')
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('fallback container', () => {
  it('warns once in dev, also across module copies', async () => {
    const { RequestKernel } = await load()
    const fallback = RequestKernel.container()
    expect(RequestKernel.container()).toBe(fallback)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toMatchInlineSnapshot(`"[@laratype/http] Controllers are resolved outside a RequestKernel request, by an autowire-only container: app bindings don't apply, and singletons it autowires live for the whole process. Serve them through RequestKernel to resolve them from the app container."`)
    const copy = await load()
    expect(copy.RequestKernel.container()).not.toBe(fallback)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('never warns when __PROD__ is set', async () => {
    vi.stubGlobal('__PROD__', true)
    const { RequestKernel } = await load()
    RequestKernel.container()
    RequestKernel.container()
    expect(warn).not.toHaveBeenCalled()
  })

  it('never warns when NODE_ENV is production', async () => {
    vi.stubGlobal('__PROD__', undefined)
    vi.stubEnv('NODE_ENV', 'production')
    const { RequestKernel } = await load()
    RequestKernel.container()
    expect(warn).not.toHaveBeenCalled()
  })

  it('never warns for a request served through RequestKernel', async () => {
    const { Container, Controller, HTTP_APP, RequestKernel, depsRegistry } = await load()
    globalThis.__laratype_route_model_bindings = {}
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
