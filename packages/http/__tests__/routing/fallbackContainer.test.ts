// D11 #318: outside RequestKernel, Request.container() is core's one app-container lookup, not an http fallback
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { appContainer, Container, depsRegistry, Facade } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import Controller from '../../src/controller/Controller'
import RequestKernel from '../../src/request/Request'

const FALLBACK_WARNED = Symbol.for('laratype.di.fallbackWarned')

const reset = () => {
  Facade.setFacadeApplication(undefined)
  delete (globalThis as { [FALLBACK_WARNED]?: true })[FALLBACK_WARNED]
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  reset()
  vi.stubGlobal('__PROD__', false)
  vi.stubEnv('NODE_ENV', 'development')
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  reset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

class Greeter {
  greet() { return 'hello' }
}
class Loud extends Greeter {
  greet() { return 'HELLO' }
}
class Greet extends Facade {
  static override readonly accessor = Greeter
  static greet() { return this.root().greet() }
}

describe('Request.container() outside RequestKernel', () => {
  it('is the one shared fallback, created once, with core warning once in dev', () => {
    const fallback = RequestKernel.container()
    expect(fallback).toBeInstanceOf(Container)
    expect(fallback).toBe(appContainer())
    expect(Facade.getFacadeApplication()).toBe(fallback)
    expect(RequestKernel.container()).toBe(fallback)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatchInlineSnapshot(`"[@laratype/core] No app container: facades and controllers use a shared autowire-only container, so app bindings do not apply and the singletons it autowires are shared for the process. Call Serve.getContainer() or setFacadeApplication() to use the app container."`)
  })

  it('is the app container when one is set, so app bindings apply outside the kernel', () => {
    const app = new Container({ deps: depsRegistry }).bind(Greeter, Loud)
    Facade.setFacadeApplication(app)
    expect(RequestKernel.container()).toBe(app)
    expect(RequestKernel.container().make(Greeter)).toBeInstanceOf(Loud)
    expect(warn).not.toHaveBeenCalled()
  })

  it('shares the fallback with facades, so a fake made there reaches a controller', () => {
    const restore = Greet.fake({ greet: () => 'faked' })
    expect(RequestKernel.container()).toBe(Facade.getFacadeApplication())
    expect(RequestKernel.container().make(Greeter).greet()).toBe('faked')
    restore()
  })

  it('never warns when __PROD__ is set', () => {
    vi.stubGlobal('__PROD__', true)
    RequestKernel.container()
    RequestKernel.container()
    expect(warn).not.toHaveBeenCalled()
  })

  it('an explicit __PROD__ = false wins over NODE_ENV=production', () => {
    vi.stubGlobal('__PROD__', false)
    vi.stubEnv('NODE_ENV', 'production')
    RequestKernel.container()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('never warns when NODE_ENV is production', () => {
    vi.stubGlobal('__PROD__', undefined)
    vi.stubEnv('NODE_ENV', 'production')
    RequestKernel.container()
    expect(warn).not.toHaveBeenCalled()
  })

  it('adds no warning of its own for a request served through RequestKernel', async () => {
    const container = new Container({ deps: depsRegistry })
    const app = new Hono()
    container.instance(HTTP_APP, app)
    new RequestKernel(container).boot()
    class Probe extends Controller {
      index() { return {} }
    }
    app.get('/probe', RequestKernel.handle({ method: 'get', path: '/probe', controller: [Probe, 'index'] }))
    expect((await app.request('/probe')).status).toBe(200)
    expect(warn.mock.calls.filter(([message]) => String(message).startsWith('[@laratype/http]'))).toHaveLength(0)
  })
})
