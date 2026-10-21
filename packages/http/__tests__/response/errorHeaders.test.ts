// H23 #272: an error response drops the headers set before the throw that would cache it or set a cookie, and keeps
// the headers the error path sets on purpose
// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP, NotFoundException } from '@laratype/support'
import { Controller, RequestKernel, ResponseKernel } from '../../src/index'

/** An app booted like `sauf dev`: RequestKernel puts the container on each request, ResponseKernel handles errors. */
const bootApp = () => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  return app
}

// The unknown-error body of docs/v1/http.md › Exceptions
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

/** Middleware that sets a session cookie, caching and validator headers and CORS before the handler runs. */
const cachingMiddleware: MiddlewareHandler = async (c, next) => {
  c.header('Set-Cookie', 'session=abc; Path=/; HttpOnly')
  c.header('Set-Cookie', 'theme=dark; Path=/', { append: true })
  c.header('Cache-Control', 'public, max-age=60')
  c.header('ETag', '"v1"')
  c.header('Last-Modified', 'Wed, 21 Oct 2026 07:28:00 GMT')
  c.header('Expires', 'Wed, 21 Oct 2026 08:28:00 GMT')
  c.header('CDN-Cache-Control', 'max-age=600')
  c.header('Surrogate-Control', 'max-age=600')
  c.header('Access-Control-Allow-Origin', 'https://app.example.test')
  await next()
}

const expectScrubbed = (response: Response) => {
  expect(response.headers.get('Set-Cookie')).toBeNull()
  expect(response.headers.getSetCookie()).toEqual([])
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('ETag')).toBeNull()
  expect(response.headers.get('Last-Modified')).toBeNull()
  expect(response.headers.get('Expires')).toBeNull()
  expect(response.headers.get('CDN-Cache-Control')).toBeNull()
  expect(response.headers.get('Surrogate-Control')).toBeNull()
  // a header the error response may carry stays
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test')
}

const route = (app: Hono, path: string, controller: new () => Controller, method = 'index') => {
  app.get(path, RequestKernel.handle({ method: 'get', path, controller: [controller as never, method] }))
}

describe('error response headers', () => {
  it('a handler that throws after middleware set Set-Cookie and Cache-Control answers without the cookie and with no-store', async () => {
    quiet()
    class Failing extends Controller { index() { throw new Error('secret detail') } }
    const app = bootApp()
    app.use(cachingMiddleware)
    route(app, '/fail', Failing)
    const response = await app.request('/fail')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(GENERIC)
    expectScrubbed(response)
  })

  it('a responsible 4xx Exception drops them too', async () => {
    quiet()
    class Missing extends Controller { index() { throw new NotFoundException('No such post.') } }
    const app = bootApp()
    app.use(cachingMiddleware)
    route(app, '/missing', Missing)
    const response = await app.request('/missing')
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ message: 'No such post.' })
    expectScrubbed(response)
  })

  it('a 4xx HTTPException drops them and keeps its own headers, but not its own cookie or caching headers', async () => {
    quiet()
    const res = new Response('Unauthorized', {
      status: 401,
      headers: [
        ['WWW-Authenticate', 'Basic realm="admin"'],
        ['Cache-Control', 'public, max-age=60'],
        ['Set-Cookie', 'tracking=1; Path=/'],
        ['ETag', '"upstream"'],
        ['CDN-Cache-Control', 'max-age=600'],
      ],
    })
    class Guarded extends Controller { index() { throw new HTTPException(401, { res }) } }
    const app = bootApp()
    app.use(cachingMiddleware)
    route(app, '/guarded', Guarded)
    const response = await app.request('/guarded')
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('Unauthorized')
    expect(response.headers.get('WWW-Authenticate')).toBe('Basic realm="admin"')
    expectScrubbed(response)
  })

  it('drops them when middleware set them on c.res, which Hono merges into the error response', async () => {
    quiet()
    class Failing extends Controller { index() { throw new NotFoundException('No such post.') } }
    const app = bootApp()
    app.use(async (c, next) => {
      c.res.headers.append('Set-Cookie', 'session=abc; Path=/')
      c.res.headers.set('Cache-Control', 'public, max-age=60')
      c.res.headers.set('ETag', '"v1"')
      c.res.headers.set('Access-Control-Allow-Origin', 'https://app.example.test')
      await next()
    })
    route(app, '/res', Failing)
    const response = await app.request('/res')
    expect(response.status).toBe(404)
    expectScrubbed(response)
  })

  it('a 5xx HTTPException keeps Retry-After from its response, with the generic body', async () => {
    quiet()
    const res = new Response('x', { headers: { 'Retry-After': '120', 'X-Upstream': 'redis-10.0.0.7' } })
    class Down extends Controller { index() { throw new HTTPException(503, { res }) } }
    const app = bootApp()
    app.use(cachingMiddleware)
    route(app, '/down', Down)
    const response = await app.request('/down')
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual(GENERIC)
    expect(response.headers.get('Retry-After')).toBe('120')
    // anything else of the error's own response is dropped
    expect(response.headers.get('X-Upstream')).toBeNull()
    expectScrubbed(response)
  })

  it('a 5xx HTTP error keeps WWW-Authenticate from its response', async () => {
    quiet()
    const failure = Object.assign(new Error('secret detail'), {
      status: 502,
      getResponse: () => new Response('secret detail', { status: 502, headers: { 'WWW-Authenticate': 'Bearer', 'Set-Cookie': 'a=b' } }),
    })
    class Gateway extends Controller { index() { throw failure } }
    const app = bootApp()
    route(app, '/gateway', Gateway)
    const response = await app.request('/gateway')
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual(GENERIC)
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('an error with status 400 whose getResponse() is a 500 answers the generic 5xx body', async () => {
    quiet()
    const failure = Object.assign(new Error('secret detail'), {
      status: 400,
      getResponse: () => new Response('secret detail at db.internal', { status: 500 }),
    })
    class Mismatch extends Controller { index() { throw failure } }
    const app = bootApp()
    route(app, '/mismatch', Mismatch)
    const response = await app.request('/mismatch')
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual(GENERIC)
    expect(text).not.toContain('secret detail')
    expect(errors).toHaveBeenCalledTimes(1)
  })

  it('an error with status 400 whose getResponse() is not an error status is an unknown error', async () => {
    quiet()
    const failure = Object.assign(new Error('secret detail'), {
      status: 400,
      getResponse: () => new Response('secret detail', { status: 200 }),
    })
    class Ok extends Controller { index() { throw failure } }
    const app = bootApp()
    route(app, '/ok', Ok)
    const response = await app.request('/ok')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(GENERIC)
    expect(errors).toHaveBeenCalledWith(failure)
  })

  it('a middleware that throws after the handler returned, and after reading its body, drops its headers', async () => {
    quiet()
    class Fine extends Controller { index() { return { ok: true } } }
    const app = bootApp()
    app.use(async (c, next) => {
      await next()
      await c.res.text()
      throw new HTTPException(401, { message: 'Unauthorized' })
    })
    app.use(cachingMiddleware)
    route(app, '/after', Fine)
    const response = await app.request('/after')
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('Unauthorized')
    expectScrubbed(response)
  })

  it('a handler returning a fetch response with immutable headers, then a throw, answers the generic 5xx', async () => {
    quiet()
    const app = bootApp()
    app.use(async (_c, next) => {
      await next()
      throw new Error('secret detail')
    })
    app.get('/proxied', async (c) => {
      // what fetch() returns: its headers are immutable
      c.res = Response.redirect('https://upstream.example.test/', 302)
      return c.res
    })
    const response = await app.request('/proxied')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(GENERIC)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('a successful response keeps the headers middleware set', async () => {
    class Fine extends Controller { index() { return { ok: true } } }
    const app = bootApp()
    app.use(cachingMiddleware)
    route(app, '/fine', Fine)
    const response = await app.request('/fine')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60')
    expect(response.headers.getSetCookie()).toHaveLength(2)
  })
})
