// H23 #272: an error response drops the headers set before the throw that would cache it or set a cookie, and keeps
// the headers the error path sets on purpose
// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { deleteCookie } from 'hono/cookie'
import { etag } from 'hono/etag'
import { HTTPException } from 'hono/http-exception'
import { Container, depsRegistry } from '@laratype/core'
import { errors as catalog } from '@laratype/contract'
import { HTTP_APP, NotFoundException } from '@laratype/support'
import { Controller, RequestKernel, Response as ResponseSupport, ResponseKernel } from '../../src/index'
import { BODY_HEADERS } from '../../src/response/bodyHeaders'
import { DROPPED_ERROR_HEADERS } from '../../src/response/Response'

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

/** The strong ETag `etag()` computes for a body: the SHA-1 of its bytes, in quotes */
const etagOf = async (body: string) => {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(body))
  return `"${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}"`
}

let errors: ReturnType<typeof vi.spyOn>

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
    // the 302's redirect is not the error's
    expect(response.headers.get('Location')).toBeNull()
  })

  /** A proxied, gzipped upstream response: its headers describe its own body, not the error's */
  const proxied = () => new Response('compressed bytes', {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'gzip',
      'Content-Length': '812',
      'Content-Range': 'bytes 0-811/812',
      'Content-Disposition': 'attachment; filename="report.csv"',
      'Content-Location': '/reports/r.csv',
      'Content-Digest': 'sha-256=:x:',
      'Refresh': '0; url=/elsewhere',
      'Transfer-Encoding': 'chunked',
      'Access-Control-Allow-Origin': 'https://app.example.test',
    },
  })

  /** Asserts the error response carries no header of the earlier body or redirect; `text` is the error's own body */
  const expectNoBodyHeaders = (response: Response, text: string) => {
    for (const name of ['Location', 'Refresh', 'Content-Encoding', 'Content-Range', 'Content-Disposition', 'Content-Location', 'Content-Digest', 'Transfer-Encoding']) {
      expect(response.headers.get(name), name).toBeNull()
    }
    expect(response.headers.get('Content-Type')).not.toBe('application/octet-stream')
    // Content-Length, when present, is the error body's own
    const length = response.headers.get('Content-Length')
    if (length !== null) expect(Number(length)).toBe(new TextEncoder().encode(text).byteLength)
  }

  for (const [label, thrown, status] of [
    ['an unknown error', () => new Error('secret detail'), 500],
    ['a 4xx HTTPException', () => new HTTPException(401, { message: 'Unauthorized' }), 401],
  ] as const) {
    it(`${label} thrown after a proxied gzip response drops its body and redirect headers`, async () => {
      quiet()
      const app = bootApp()
      app.use(async (_c, next) => {
        await next()
        throw thrown()
      })
      app.get('/download', (c) => {
        c.res = proxied()
        return c.res
      })
      const response = await app.request('/download')
      expect(response.status).toBe(status)
      const text = await response.text()
      expect(text).not.toBe('compressed bytes')
      expectNoBodyHeaders(response, text)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      // a header the error response may carry stays
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test')
    })
  }

  it('a handler that sets body and redirect headers with c.header() and then throws answers without them', async () => {
    quiet()
    const app = bootApp()
    app.get('/export', (c) => {
      c.header('Content-Type', 'application/octet-stream')
      c.header('Content-Disposition', 'attachment; filename="report.csv"')
      c.header('Content-Length', '812')
      c.header('Location', '/reports/r.csv')
      c.header('Access-Control-Allow-Origin', 'https://app.example.test')
      // the request's locale, which the error's message is in too
      c.header('Content-Language', 'fr')
      throw new Error('secret detail')
    })
    const response = await app.request('/export')
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual(GENERIC)
    expectNoBodyHeaders(response, text)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test')
    expect(response.headers.get('Content-Language')).toBe('fr')
  })

  // Security review of #281: before Hono 4.8 a second header store put these back. CI runs the lockfile's hono; this
  // case also passes on 4.8.0, the peer floor, and fails on 4.7
  for (const [label, thrown, status] of [
    ['an unknown error', () => new Error('secret detail'), 500],
    ['a 4xx HTTPException', () => new HTTPException(401, { message: 'Unauthorized' }), 401],
  ] as const) {
    it(`${label} thrown after await next(), once the route answered through resolveResponse, drops its cookie, validators and Location`, async () => {
      quiet()
      class Session extends Controller {
        index() {
          return new ResponseSupport({ ok: true }, 200, {
            'Set-Cookie': 'sid=secret; HttpOnly',
            'ETag': '"v1"',
            'Last-Modified': 'Wed, 21 Oct 2026 07:28:00 GMT',
            'Expires': 'Wed, 21 Oct 2026 08:28:00 GMT',
            'Cache-Control': 'public, max-age=60',
            'CDN-Cache-Control': 'max-age=600',
            'Surrogate-Control': 'max-age=600',
            'Access-Control-Allow-Origin': 'https://app.example.test',
            'Location': '/next',
          })
        }
      }
      const app = bootApp()
      app.use(async (_c, next) => {
        await next()
        throw thrown()
      })
      route(app, '/session', Session)
      const response = await app.request('/session')
      expect(response.status).toBe(status)
      const text = await response.text()
      if (status >= 500) expect(JSON.parse(text)).toEqual(GENERIC)
      expect(text).not.toContain('"ok"')
      expectScrubbed(response)
      expect(response.headers.get('Location')).toBeNull()
    })
  }

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

// H29 #295: the outermost middleware scrubs what a middleware writes after `await next()`, and keeps only the
// `Set-Cookie` values that expire a cookie
describe('error response headers set after the throw', () => {
  it('etag() cannot turn a 500 into a 304 with a matching validator, and does not run onError again', async () => {
    quiet()
    const failure = new Error('secret detail')
    class Failing extends Controller { index() { throw failure } }
    const app = bootApp()
    app.use(etag())
    route(app, '/fail', Failing)
    const first = await app.request('/fail')
    expect(first.status).toBe(500)
    const body = await first.text()
    expect(JSON.parse(body)).toEqual(GENERIC)
    // The validator etag() computes for that body: a cache could hold it even though it never reaches a client
    expect(first.headers.get('ETag')).toBeNull()
    errors.mockClear()
    const second = await app.request('/fail', { headers: { 'If-None-Match': await etagOf(body) } })
    expect(second.status).toBe(500)
    expect(await second.json()).toEqual(GENERIC)
    expect(second.headers.get('Cache-Control')).toBe('no-store')
    // The stored 500 is put back, never disturbed: onError runs once, for the thrown error, and logs no TypeError
    expect(errors).toHaveBeenCalledTimes(1)
    expect(errors).toHaveBeenCalledWith(failure)
  })

  // A middleware that replaces the error's answer (`etag()`'s 304) must not leave the stored answer unusable: the put
  // back reads a body etag()'s clone did not tee and lock (#388)
  for (const [label, thrown, status, body] of [
    ['responsible 4xx Exception', () => new NotFoundException('No such post.'), 404, JSON.stringify({ code: 'NOT_FOUND', message: 'No such post.' })],
    ['contract error', () => catalog.notFound('No such post.'), 404, JSON.stringify({ code: 'NOT_FOUND', message: 'No such post.' })],
    ['4xx HTTPException', () => new HTTPException(401, { message: 'Unauthorized' }), 401, 'Unauthorized'],
  ] as const) {
    it(`etag() puts the answer of a ${label} back on a matching If-None-Match`, async () => {
      quiet()
      class Failing extends Controller { index() { throw thrown() } }
      const app = bootApp()
      app.use(etag())
      route(app, '/fail', Failing)
      const first = await app.request('/fail')
      expect(first.status).toBe(status)
      expect(await first.text()).toBe(body)
      expect(first.headers.get('ETag')).toBeNull()
      const second = await app.request('/fail', { headers: { 'If-None-Match': await etagOf(body) } })
      expect(second.status).toBe(status)
      expect(await second.text()).toBe(body)
      expect(second.headers.get('ETag')).toBeNull()
      expect(second.headers.get('Cache-Control')).toBe('no-store')
      // an expected answer is not logged, and the put back throws no TypeError that onError would log
      expect(errors).not.toHaveBeenCalled()
    })
  }

  it('drops a Set-Cookie a session-style middleware adds after next() to a 500', async () => {
    quiet()
    class Failing extends Controller { index() { throw new Error('secret detail') } }
    const app = bootApp()
    app.use(async (c, next) => {
      await next()
      c.header('Set-Cookie', 'session=fresh; Path=/; HttpOnly')
    })
    route(app, '/fail', Failing)
    const response = await app.request('/fail')
    expect(response.status).toBe(500)
    expect(response.headers.getSetCookie()).toEqual([])
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('keeps a cookie a middleware expires after next() to a 500', async () => {
    quiet()
    class Failing extends Controller { index() { throw new Error('secret detail') } }
    const app = bootApp()
    app.use(async (c, next) => {
      await next()
      c.header('Set-Cookie', 'session=; Max-Age=0; Path=/; HttpOnly')
    })
    route(app, '/fail', Failing)
    const response = await app.request('/fail')
    expect(response.status).toBe(500)
    expect(response.headers.getSetCookie()).toEqual(['session=; Max-Age=0; Path=/; HttpOnly'])
  })

  // H29 #388: the scrub's own pass reads DROPPED_ERROR_HEADERS, so an offload header a proxy would honour must be in
  // it, without taking the error body's own headers with it
  it.each([
    'X-Accel-Redirect', 'X-Sendfile', 'X-Lighttpd-Send-File', 'X-LiteSpeed-Location',
  ])('drops %s a middleware sets after next() on a 500, keeping the error body headers', async (name) => {
    quiet()
    class Failing extends Controller { index() { throw new Error('secret detail') } }
    const app = bootApp()
    app.use(async (c, next) => {
      await next()
      c.header(name, '/private/report.pdf')
    })
    route(app, '/offload', Failing)
    const response = await app.request('/offload')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(GENERIC)
    expect(response.headers.get(name)).toBeNull()
    // DROPPED_ERROR_HEADERS only: the error body's own Content-Type survives
    expect(response.headers.get('Content-Type')).toContain('application/json')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('is outermost when the kernel registers before the routes, as in the production boot', async () => {
    quiet()
    class Failing extends Controller { index() { throw new Error('secret detail') } }
    const container = new Container({ deps: depsRegistry })
    const app = new Hono()
    container.instance(HTTP_APP, app)
    new RequestKernel(container).boot()
    const kernel = new ResponseKernel(container)
    // the app providers mount their routes in boot(), after this kernel registered
    kernel.register()
    app.use(async (c, next) => {
      await next()
      c.header('Set-Cookie', 'session=fresh; Path=/; HttpOnly')
    })
    route(app, '/fail', Failing)
    kernel.boot()
    const response = await app.request('/fail')
    expect(response.status).toBe(500)
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('keeps CORS headers a middleware sets before the throw', async () => {
    quiet()
    class Failing extends Controller { index() { throw new Error('secret detail') } }
    const app = bootApp()
    app.use(async (c, next) => {
      c.header('Access-Control-Allow-Origin', 'https://app.example.test')
      c.header('Vary', 'Origin')
      await next()
    })
    route(app, '/fail', Failing)
    const response = await app.request('/fail')
    expect(response.status).toBe(500)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test')
    expect(response.headers.get('Vary')).toBe('Origin')
  })
})

// H29 #295: the two lists, every entry, and the body headers on an error's own response
describe('header lists', () => {
  it('drops every body header the handler set before the throw', async () => {
    quiet()
    const app = bootApp()
    app.get('/bodies', (c) => {
      for (const name of BODY_HEADERS) c.header(name, 'handler-value')
      throw new Error('secret detail')
    })
    const response = await app.request('/bodies')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(GENERIC)
    for (const name of BODY_HEADERS) {
      const value = response.headers.get(name)
      if (name === 'Content-Type' || name === 'Content-Length') {
        // the error body's own, never the handler's
        expect(value, name).not.toBe('handler-value')
      }
      else expect(value, name).toBeNull()
    }
  })

  it.each([
    'X-Accel-Redirect', 'X-Sendfile', 'X-Lighttpd-Send-File', 'X-LiteSpeed-Location',
  ])('drops %s, which would make the server send a file in place of the error body', async (name) => {
    quiet()
    const app = bootApp()
    app.get('/offload', (c) => {
      c.header(name, '/private/report.pdf')
      throw new Error('secret detail')
    })
    const response = await app.request('/offload')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(GENERIC)
    expect(response.headers.get(name)).toBeNull()
  })

  it('drops every caching, validator and vendor header the handler set before the throw', async () => {
    quiet()
    const app = bootApp()
    app.get('/cache', (c) => {
      for (const name of DROPPED_ERROR_HEADERS) {
        c.header(name, name === 'Set-Cookie' ? 'session=abc; Path=/' : 'handler-value')
      }
      throw new Error('secret detail')
    })
    const response = await app.request('/cache')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(GENERIC)
    for (const name of DROPPED_ERROR_HEADERS) {
      if (name === 'Set-Cookie') expect(response.headers.getSetCookie(), name).toEqual([])
      else expect(response.headers.get(name), name).toBeNull()
    }
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('drops the cache, validator and offload headers of a 4xx HTTPException own response, keeping its other ones', async () => {
    quiet()
    const res = new Response('Too Many Requests', {
      status: 429,
      headers: {
        'ETag': '"upstream"',
        'Last-Modified': 'Wed, 21 Oct 2026 07:28:00 GMT',
        'Expires': 'Wed, 21 Oct 2026 08:28:00 GMT',
        'Age': '60',
        'Surrogate-Key': 'post-1',
        'Cache-Tag': 'post-1',
        'Cloudflare-CDN-Cache-Control': 'max-age=600',
        'Surrogate-Control': 'max-age=600',
        'X-Accel-Expires': '600',
        'Vercel-CDN-Cache-Control': 'max-age=600',
        'Netlify-CDN-Cache-Control': 'max-age=600',
        'Edge-Control': 'no-store',
        // an error response never lets a proxy serve a file, not even the error's own
        'X-Accel-Redirect': '/private/report.pdf',
        'X-Upstream': 'redis-10.0.0.7',
      },
    })
    class Limited extends Controller { index() { throw new HTTPException(429, { res }) } }
    const app = bootApp()
    route(app, '/limited', Limited)
    const response = await app.request('/limited')
    expect(response.status).toBe(429)
    for (const name of [
      'ETag', 'Last-Modified', 'Expires', 'Age', 'Surrogate-Key', 'Cache-Tag', 'Cloudflare-CDN-Cache-Control',
      'Surrogate-Control', 'X-Accel-Expires', 'Vercel-CDN-Cache-Control', 'Netlify-CDN-Cache-Control', 'Edge-Control',
      'X-Accel-Redirect',
    ]) {
      expect(response.headers.get(name), name).toBeNull()
    }
    expect(response.headers.get('X-Upstream')).toBe('redis-10.0.0.7')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})

// H29 #295: the potential answer of an HTTPException is not always sent, so its body stream is cancelled
describe('cancelled bodies', () => {
  it('cancels the finalized body a throw drops', async () => {
    quiet()
    let cancelled = 0
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('report')) },
      cancel() { cancelled += 1 },
    })
    class Fine extends Controller { index() { return { ok: true } } }
    const app = bootApp()
    app.use(async (c, next) => {
      await next()
      c.res = new Response(stream, { status: 200, headers: { 'Content-Type': 'application/pdf' } })
      throw new Error('secret detail')
    })
    route(app, '/stream', Fine)
    const response = await app.request('/stream')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(GENERIC)
    await vi.waitFor(() => expect(cancelled).toBe(1))
  })

  it('cancels the HTTPException own body on the 5xx path', async () => {
    quiet()
    let cancelled = 0
    const stream = new ReadableStream({ cancel() { cancelled += 1 } })
    const res = new Response(stream, { status: 503, headers: { 'Retry-After': '120' } })
    class Down extends Controller { index() { throw new HTTPException(503, { res }) } }
    const app = bootApp()
    route(app, '/down', Down)
    const response = await app.request('/down')
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('120')
    expect(await response.json()).toEqual(GENERIC)
    await vi.waitFor(() => expect(cancelled).toBe(1))
  })

  // H29 #388: Hono calls onError again when a middleware throws after `await next()`, so a second answer replaces the
  // stored clone; the one it replaces is cancelled instead of staying open on the context's tee source
  it('cancels the first stored clone when a second error answers the same context', async () => {
    quiet()
    let cancelled = 0
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode('chunk')) },
      cancel() { cancelled += 1 },
    })
    const res = new Response(stream, { status: 429, headers: { 'Content-Type': 'text/plain' } })
    let firstAnswer: Response | undefined
    class Limited extends Controller { index() { throw new HTTPException(429, { res }) } }
    const app = bootApp()
    app.use(async (c, next) => {
      await next()
      // the route's throw already answered; the next throw makes Hono call onError a second time on this context
      firstAnswer = c.res
      throw new HTTPException(401, { message: 'Unauthorized' })
    })
    route(app, '/limited', Limited)
    const response = await app.request('/limited')
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('Unauthorized')
    expect(firstAnswer).toBeDefined()
    // A tee cancels its source once both branches are cancelled: the second answer cancelled the stored clone, this the
    // first answer's own branch
    await firstAnswer!.body!.cancel()
    await vi.waitFor(() => expect(cancelled).toBe(1), { timeout: 2_000 })
  })

  // H29 #388: the stored clone is cancelled when it is not put back, so a client that stops reading does not leave an
  // unread tee branch holding the upstream body open
  it('cancels the stored clone of a streamed 4xx HTTPException once the client cancels', async () => {
    quiet()
    let cancelled = 0
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode('chunk')) },
      cancel() { cancelled += 1 },
    })
    const res = new Response(stream, { status: 429, headers: { 'Content-Type': 'text/plain' } })
    class Limited extends Controller { index() { throw new HTTPException(429, { res }) } }
    const app = bootApp()
    route(app, '/limited', Limited)
    const response = await app.request('/limited')
    expect(response.status).toBe(429)
    const body = response.body
    expect(body).not.toBeNull()
    const reader = body!.getReader()
    expect((await reader.read()).done).toBe(false)
    await reader.cancel()
    // A tee cancels its source once both branches are cancelled: the scrub cancelled the stored clone, the client this
    // branch. The wait is bounded because the cancellations are promises.
    await vi.waitFor(() => expect(cancelled).toBe(1), { timeout: 2_000 })
  })
})

// H29 #295: keep every WWW-Authenticate challenge, and the error response's own value wins over a c.header() one
describe('WWW-Authenticate', () => {
  it('keeps both challenges of a 5xx HTTP error', async () => {
    quiet()
    const failure = Object.assign(new Error('secret detail'), {
      status: 502,
      getResponse: () => new Response('secret detail', {
        status: 502,
        headers: [
          ['WWW-Authenticate', 'Basic realm="admin"'],
          ['WWW-Authenticate', 'Bearer realm="api"'],
        ],
      }),
    })
    class Gateway extends Controller { index() { throw failure } }
    const app = bootApp()
    route(app, '/challenges', Gateway)
    const response = await app.request('/challenges')
    expect(response.status).toBe(502)
    const challenge = response.headers.get('WWW-Authenticate') ?? ''
    expect(challenge).toContain('Basic realm="admin"')
    expect(challenge).toContain('Bearer realm="api"')
  })

  it('a WWW-Authenticate and Retry-After set before the throw do not replace the 4xx HTTPException own ones', async () => {
    quiet()
    const res = new Response('Too Many Requests', {
      status: 429,
      headers: { 'WWW-Authenticate': 'Bearer realm="api"', 'Retry-After': '120' },
    })
    class Limited extends Controller { index() { throw new HTTPException(429, { res }) } }
    const app = bootApp()
    app.use(async (c, next) => {
      c.header('WWW-Authenticate', 'Basic realm="middleware"')
      c.header('Retry-After', '1')
      await next()
    })
    route(app, '/limited', Limited)
    const response = await app.request('/limited')
    expect(response.status).toBe(429)
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer realm="api"')
    expect(response.headers.get('Retry-After')).toBe('120')
  })
})

// H29 #295: an error response keeps the cookies that expire one, and drops every other one
describe('expiring cookies', () => {
  it('a 401 that clears the session cookie keeps the clearing cookie', async () => {
    quiet()
    class Guarded extends Controller { index() { throw new HTTPException(401, { message: 'Unauthorized' }) } }
    const app = bootApp()
    app.use(async (c, next) => {
      deleteCookie(c, 'session', { path: '/' })
      await next()
    })
    route(app, '/guarded', Guarded)
    const response = await app.request('/guarded')
    expect(response.status).toBe(401)
    expect(response.headers.getSetCookie()).toEqual(['session=; Max-Age=0; Path=/'])
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('drops a fresh session cookie on a 500', async () => {
    quiet()
    class Failing extends Controller { index() { throw new Error('secret detail') } }
    const app = bootApp()
    app.use(async (c, next) => {
      c.header('Set-Cookie', 'session=fresh; Path=/; HttpOnly')
      await next()
    })
    route(app, '/fail', Failing)
    const response = await app.request('/fail')
    expect(response.status).toBe(500)
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('keeps only the cookies that expire one in a mixed list', async () => {
    quiet()
    class Failing extends Controller { index() { throw new Error('secret detail') } }
    const app = bootApp()
    app.use(async (c, next) => {
      c.header('Set-Cookie', 'theme=dark; Path=/')
      c.header('Set-Cookie', 'session=; Max-Age=0; Path=/', { append: true })
      c.header('Set-Cookie', 'legacy=; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/', { append: true })
      c.header('Set-Cookie', 'broken=; Expires=not-a-date; Path=/', { append: true })
      // a cookie named Max-Age: its pair is data, not an attribute
      c.header('Set-Cookie', 'Max-Age=fresh; Path=/', { append: true })
      await next()
    })
    route(app, '/fail', Failing)
    const response = await app.request('/fail')
    expect(response.status).toBe(500)
    expect(response.headers.getSetCookie()).toEqual([
      'session=; Max-Age=0; Path=/',
      'legacy=; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/',
    ])
  })

  // V8's Date.parse reads dates a browser's RFC 6265 cookie parser does not, and a malformed Max-Age is not an
  // expiry either way (#388)
  it.each([
    'sid=abc; Expires=0',
    'sid=abc; Expires=2000',
    'sid=abc; Expires=Wed, 01 Jan 60 00:00:00 GMT',
    // RFC 6265 §5.1.1: a cookie-date year is 1601 or later, so a browser keeps this cookie as a session one (#388)
    'sid=abc; Expires=Sat, 01 Jan 1600 00:00:00 GMT',
    'sid=abc; Max-Age=+3600; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ])('drops %s, whose expiry is not an RFC 6265 one', async (cookie) => {
    quiet()
    class Failing extends Controller { index() { throw new Error('secret detail') } }
    const app = bootApp()
    app.use(async (c, next) => {
      c.header('Set-Cookie', cookie)
      await next()
    })
    route(app, '/fail', Failing)
    const response = await app.request('/fail')
    expect(response.status).toBe(500)
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it('keeps an expiring cookie of a 4xx HTTPException own response', async () => {
    quiet()
    const res = new Response('Unauthorized', {
      status: 401,
      headers: { 'Set-Cookie': 'session=; Max-Age=0; Path=/' },
    })
    class Guarded extends Controller { index() { throw new HTTPException(401, { res }) } }
    const app = bootApp()
    route(app, '/guarded', Guarded)
    const response = await app.request('/guarded')
    expect(response.status).toBe(401)
    expect(response.headers.getSetCookie()).toEqual(['session=; Max-Age=0; Path=/'])
  })
})
