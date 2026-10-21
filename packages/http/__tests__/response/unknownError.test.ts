// H20 #267: an unknown error answers 500 with a generic body, whatever the route or controller status
// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { Container, depsRegistry } from '@laratype/core'
import { Exception, HTTP_APP, MetaDataKey, NotFoundException } from '@laratype/support'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, RequestKernel, ResponseKernel, Route } from '../../src/index'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const

/** An app booted like `sauf dev`: RequestKernel puts the container on each request, ResponseKernel handles errors. */
const bootApp = () => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  return app
}

// The unknown-error body of docs/v1/http.md › Exceptions: no code, so the client classifies it as unexpected
const GENERIC = { message: 'Server Error' }

let errors: ReturnType<typeof vi.spyOn>

beforeAll(() => {
  globalThis.__laratype_route_model_bindings = {}
})

const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
}

afterEach(() => {
  vi.restoreAllMocks()
})

const expectGeneric500 = async (response: Response, ...hidden: string[]) => {
  expect(response.status).toBe(500)
  const text = await response.text()
  expect(JSON.parse(text)).toEqual(GENERIC)
  for (const value of hidden) expect(text).not.toContain(value)
}

describe('unknown errors', () => {
  it('a plain Error answers 500 with a generic body and is logged on the server', async () => {
    quiet()
    const failure = new Error('secret detail')
    class Failing extends Controller { index() { throw failure } }
    const app = bootApp()
    app.get('/fail', RequestKernel.handle({ method: 'get', path: '/fail', controller: [Failing, 'index'] }))
    await expectGeneric500(await app.request('/fail'), 'secret detail', 'at ')
    expect(errors).toHaveBeenCalledWith(failure)
  })

  it('a Route.api endpoint with a declared 201 still answers 500', async () => {
    quiet()
    const posts = defineContract()({ store: endpoint.post('/').response(anything, 201), ping: endpoint.get('/ping').status(204) })
    const postsApi = defineApi({ posts: { contract: posts, path: '/api/posts', scopes: [], dirs: [] } })
    class Posts extends Controller {
      store() { throw new Error('secret detail') }
      ping() { throw new TypeError('secret detail') }
    }
    const app = bootApp()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    Route.api(postsApi, (r) => [r.contract(posts, Posts)]).mount(app)
    await expectGeneric500(await app.request('/api/posts', { method: 'POST' }), 'secret detail')
    // a body-less 204 endpoint too: the 500 carries the generic body
    await expectGeneric500(await app.request('/api/posts/ping'), 'secret detail', 'TypeError')
  })

  it('a 0.5 controller with a status decorator or a store method still answers 500', async () => {
    quiet()
    class Legacy extends Controller {
      store() { throw new Error('secret detail') }
      create() { throw new Error('secret detail') }
    }
    Reflect.defineMetadata(MetaDataKey.CONTROLLER_STATUS_CODE, 201, Legacy.prototype, 'create')
    const app = bootApp()
    app.post('/store', RequestKernel.handle({ method: 'post', path: '/store', controller: [Legacy, 'store'] }))
    app.post('/create', RequestKernel.handle({ method: 'post', path: '/create', status: 201, controller: [Legacy, 'create'] }))
    await expectGeneric500(await app.request('/store', { method: 'POST' }), 'secret detail')
    await expectGeneric500(await app.request('/create', { method: 'POST' }), 'secret detail')
  })

  it('a DiError from controller resolution answers 500 without class names', async () => {
    quiet()
    class Hidden {}
    class NoMetaController extends Controller {
      constructor(readonly hidden: Hidden) { super() }
      index() { return {} }
    }
    const app = bootApp()
    app.get('/di', RequestKernel.handle({ method: 'get', path: '/di', controller: [NoMetaController, 'index'] }))
    await expectGeneric500(await app.request('/di'), 'NoMetaController', 'DiError', 'autowire', 'laratype:di')
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({ name: 'DiError' }))
  })

  it('an Exception that is not responsible answers 500 under a declared status', async () => {
    quiet()
    class Hidden extends Controller {
      store() { throw new Exception({ message: 'secret detail', responsible: false }) }
    }
    const app = bootApp()
    app.post('/hidden', RequestKernel.handle({ method: 'post', path: '/hidden', status: 201, controller: [Hidden, 'store'] }))
    await expectGeneric500(await app.request('/hidden', { method: 'POST' }), 'secret detail')
  })

  it("a Hono HTTPException keeps its own response", async () => {
    quiet()
    class Limited extends Controller { store() { throw new HTTPException(413, { message: 'Payload Too Large' }) } }
    const app = bootApp()
    app.post('/limited', RequestKernel.handle({ method: 'post', path: '/limited', status: 201, controller: [Limited, 'store'] }))
    const response = await app.request('/limited', { method: 'POST' })
    expect(response.status).toBe(413)
    expect(errors).not.toHaveBeenCalled()
  })

  it('a responsible Exception keeps its own status and body', async () => {
    quiet()
    class Missing extends Controller { store() { throw new NotFoundException('No such post.') } }
    const app = bootApp()
    app.post('/missing', RequestKernel.handle({ method: 'post', path: '/missing', status: 201, controller: [Missing, 'store'] }))
    const response = await app.request('/missing', { method: 'POST' })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ message: 'No such post.' })
  })
})
