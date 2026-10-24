// H20 #267: an unknown error answers 500 with a generic body, whatever the route or controller status
// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { Container, depsRegistry } from '@laratype/core'
import { Exception, HTTP_APP, InternalException, MetaDataKey, NotFoundException } from '@laratype/support'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Request as LaratypeRequest, RequestKernel, ResponseKernel, Route } from '../../src/index'

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

// The log counts below are of console.error, the one resolveException writes. The Exception constructor's own consola
// log of reportable Exceptions is separate (#273) and not counted
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

const expectGeneric500 = async (response: Response, ...hidden: string[]) => expectGeneric(response, 500, ...hidden)

const expectGeneric = async (response: Response, status: number, ...hidden: string[]) => {
  expect(response.status).toBe(status)
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
    expect(errors).toHaveBeenCalledTimes(1)
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
    app.post('/create', RequestKernel.handle({ method: 'post', path: '/create', controller: [Legacy, 'create'] }))
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
    app.post('/hidden', RequestKernel.handle({ method: 'post', path: '/hidden', controller: [Hidden, 'store'] }))
    await expectGeneric500(await app.request('/hidden', { method: 'POST' }), 'secret detail')
  })

  it("a Hono HTTPException keeps its own response", async () => {
    quiet()
    class Limited extends Controller { store() { throw new HTTPException(413, { message: 'Payload Too Large' }) } }
    const app = bootApp()
    app.post('/limited', RequestKernel.handle({ method: 'post', path: '/limited', controller: [Limited, 'store'] }))
    const response = await app.request('/limited', { method: 'POST' })
    expect(response.status).toBe(413)
    expect(errors).not.toHaveBeenCalled()
  })

  it('a non-responsible Exception that is not reportable is still logged, once', async () => {
    quiet()
    const failure = new Exception({ message: 'secret detail', responsible: false, reportable: false })
    class Quiet extends Controller { index() { throw failure } }
    const app = bootApp()
    app.get('/quiet', RequestKernel.handle({ method: 'get', path: '/quiet', controller: [Quiet, 'index'] }))
    await expectGeneric500(await app.request('/quiet'), 'secret detail')
    expect(errors).toHaveBeenCalledTimes(1)
    expect(errors).toHaveBeenCalledWith(failure)
  })

  it('a responsible 5xx Exception (InternalException) answers the generic body and is logged once', async () => {
    quiet()
    class Internal extends Controller { store() { throw new InternalException('Model User does not have a primary key defined.') } }
    const app = bootApp()
    app.post('/internal', RequestKernel.handle({ method: 'post', path: '/internal', controller: [Internal, 'store'] }))
    await expectGeneric500(await app.request('/internal', { method: 'POST' }), 'primary key', 'User', 'INTERNAL_ERROR')
    expect(errors).toHaveBeenCalledTimes(1)
  })

  it('the reserved-endpoint error of a request class reaches the client as the generic 500', async () => {
    quiet()
    const items = defineContract()({ index: endpoint.get('/').response(anything) })
    class SecretRequest extends LaratypeRequest { endpoint = 'mine' }
    class Items extends Controller { index() { return {} } }
    const app = bootApp()
    app.get('/items', RequestKernel.handle({ method: 'get', path: '/items', name: 'items.index', request: SecretRequest, endpoint: items.index, controller: [Items, 'index'] }))
    await expectGeneric500(await app.request('/items'), 'SecretRequest', 'items.index', 'endpoint')
  })

  it('a 5xx HTTPException keeps its status with the generic body and is logged', async () => {
    quiet()
    class Down extends Controller { index() { throw new HTTPException(503, { message: 'redis at 10.0.0.7 refused' }) } }
    const app = bootApp()
    app.get('/down', RequestKernel.handle({ method: 'get', path: '/down', controller: [Down, 'index'] }))
    await expectGeneric(await app.request('/down'), 503, 'redis', '10.0.0.7')
    expect(errors).toHaveBeenCalledTimes(1)
  })

  it('an HTTPException from another copy of hono is told by its shape', async () => {
    quiet()
    // what `instanceof HTTPException` misses when the app has a second hono
    const foreign = Object.assign(new Error('Unauthorized'), { status: 401, getResponse: () => new Response('Unauthorized', { status: 401 }) })
    class Guarded extends Controller { index() { throw foreign } }
    const app = bootApp()
    app.get('/guarded', RequestKernel.handle({ method: 'get', path: '/guarded', controller: [Guarded, 'index'] }))
    const response = await app.request('/guarded')
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('Unauthorized')
    expect(errors).not.toHaveBeenCalled()
  })

  it('a 4xx HTTPException keeps the headers middleware set (CORS)', async () => {
    quiet()
    class Guarded extends Controller { index() { throw new HTTPException(401, { message: 'Unauthorized' }) } }
    const app = bootApp()
    app.use(async (c, next) => {
      c.header('Access-Control-Allow-Origin', 'https://app.example.test')
      await next()
    })
    app.get('/cors', RequestKernel.handle({ method: 'get', path: '/cors', controller: [Guarded, 'index'] }))
    const response = await app.request('/cors')
    expect(response.status).toBe(401)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test')
    expect(await response.text()).toBe('Unauthorized')
  })

  it('an error shaped like an HTTP error but with an object getResponse() or a status out of 400-599 is unknown', async () => {
    quiet()
    const nestLike = Object.assign(new Error('secret detail'), { status: 403, getResponse: () => ({ statusCode: 403, message: 'secret detail' }) })
    const odd = Object.assign(new Error('secret detail'), { status: 999, getResponse: () => new Response('secret detail', { status: 200 }) })
    class Odd extends Controller {
      index() { throw nestLike }
      show() { throw odd }
    }
    const app = bootApp()
    app.get('/nest', RequestKernel.handle({ method: 'get', path: '/nest', controller: [Odd, 'index'] }))
    app.get('/odd', RequestKernel.handle({ method: 'get', path: '/odd', controller: [Odd, 'show'] }))
    await expectGeneric500(await app.request('/nest'), 'secret detail')
    await expectGeneric500(await app.request('/odd'), 'secret detail')
    expect(errors).toHaveBeenCalledTimes(2)
  })

  it('a responsible Exception keeps its own status and body', async () => {
    quiet()
    class Missing extends Controller { store() { throw new NotFoundException('No such post.') } }
    const app = bootApp()
    app.post('/missing', RequestKernel.handle({ method: 'post', path: '/missing', controller: [Missing, 'store'] }))
    const response = await app.request('/missing', { method: 'POST' })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ message: 'No such post.' })
    // a 4xx that is not reportable is not logged
    expect(errors).not.toHaveBeenCalled()
  })
})
