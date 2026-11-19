// H4 #107: a Route.api route answers with its endpoint's status and a JSON body, checked against the response schema in dev
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { defineApi, defineContract, defineError, endpoint } from '@laratype/contract'
import { Controller, JsonResource, Middleware, Request as LaratypeRequest, RequestKernel, Response as LaratypeResponse, ResponseKernel, Route } from '../../src/index'

const User = z.object({ id: z.number(), name: z.string() })
const users = defineContract()({
  index: endpoint.get('/').response(z.array(User)),
  show: endpoint.get('/:id').response(User),
  store: endpoint.post('/').response(User, 201),
  destroy: endpoint.delete('/:id'),
  queue: endpoint.post('/:id/jobs').status(202),
  reset: endpoint.post('/:id/reset').status(205),
  joined: endpoint.get('/:id/joined').response(z.object({ at: z.date() })),
  update: endpoint.put('/:id').response(User),
  create: endpoint.post('/create').response(User, 201),
})
const usersApi = defineApi({ users: { contract: users, path: '/api/users', scopes: [], dirs: [] } })

let result: unknown
class UserController extends Controller {
  index() { return [{ id: 1, name: 'Ada' }] }
  show() { return result }
  store() { return { id: 2, name: 'Grace' } }
  destroy() { return { deleted: true } }
  queue() { return { queued: true } }
  reset() { return undefined }
  joined() { return { at: new Date('2026-10-22T00:00:00.000Z') } }
  update() { return result }
  create() { return result }
}

/** An app booted like `sauf dev`: RequestKernel puts the container on each request, ResponseKernel handles errors. */
const bootApp = (use?: (app: Hono) => void) => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  use?.(app)
  Route.api(usersApi, (r) => [r.contract(users, UserController)]).mount(app)
  return app
}

let errors: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  result = { id: 1, name: 'Ada' }
  vi.spyOn(console, 'log').mockImplementation(() => {})
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('__PROD__', false)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('status from the contract', () => {
  it('200 with a JSON body for .response(schema)', async () => {
    const response = await bootApp().request('/api/users/1')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^application\/json/)
    expect(await response.json()).toEqual({ id: 1, name: 'Ada' })
  })

  it('201 for .response(schema, 201), whatever the method name', async () => {
    const response = await bootApp().request('/api/users', { method: 'POST' })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ id: 2, name: 'Grace' })
  })

  it('204 with no body for an endpoint without a response schema, whatever the handler returns', async () => {
    const response = await bootApp().request('/api/users/1', { method: 'DELETE' })
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it('.status(202) and .status(205) answer with no body', async () => {
    const app = bootApp()
    const queued = await app.request('/api/users/1/jobs', { method: 'POST' })
    expect(queued.status).toBe(202)
    expect(await queued.text()).toBe('')
    const reset = await app.request('/api/users/1/reset', { method: 'POST' })
    expect(reset.status).toBe(205)
    expect(await reset.text()).toBe('')
  })

  it('a 0.5 Response keeps its headers and content; a status other than the endpoint\'s is a 500', async () => {
    const app = bootApp()
    result = new LaratypeResponse({ id: 3, name: 'Linus' }, 200, { 'X-Total': '1', 'Content-Type': 'text/html' })
    const ok = await app.request('/api/users/3')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('x-total')).toBe('1')
    expect(ok.headers.get('content-type')).toMatch(/^application\/json/)
    expect(await ok.json()).toEqual({ id: 3, name: 'Linus' })

    result = new LaratypeResponse({ id: 3, name: 'Linus' }, 201)
    const wrong = await app.request('/api/users/3')
    expect(wrong.status).toBe(500)
    expect(await wrong.json()).toEqual({ message: 'Server Error' })
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({
      message: '[@laratype/http] users.show: the handler answered status 201, but the endpoint declares 200: declare it on the endpoint (.response(schema, 201) or .status(201))',
    }))
  })

  it('a 0.5 redirect keeps the handler\'s non-body headers, the redirect its own Location', async () => {
    // H32 #312: a redirect drops the body headers (it sends no body) and the handler's Location (the redirect names
    // its target), but Set-Cookie and every other header the handler set stay
    result = new LaratypeResponse(null, undefined, {
      'Set-Cookie': 'sid=abc; Path=/',
      'X-Foo': 'bar',
      'Content-Type': 'text/html',
      'Location': '/ignored',
    }).redirect('/login')
    const response = await bootApp().request('/api/users/1')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/login')
    expect(response.headers.getSetCookie()).toEqual(['sid=abc; Path=/'])
    expect(response.headers.get('x-foo')).toBe('bar')
    expect(response.headers.get('content-type')).toBeNull()
  })

  it('a handler-returned 5xx Response runs the same header scrub as a thrown error', async () => {
    // H32 #312: the status and body are the handler's; the cookie and cache headers are not an error response's (#272)
    result = new LaratypeResponse({ message: 'db down' }, 503, {
      'Set-Cookie': 'sid=abc; Path=/',
      'Cache-Control': 'public, max-age=60',
      'ETag': '"v1"',
      'Retry-After': '5',
      'X-Detail': 'kept',
    })
    const response = await bootApp().request('/api/users/1')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ message: 'db down' })
    expect(response.headers.getSetCookie()).toEqual([])
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('etag')).toBeNull()
    // headers that don't cache or set a cookie are the handler's, and stay
    expect(response.headers.get('retry-after')).toBe('5')
    expect(response.headers.get('x-detail')).toBe('kept')
  })

  it('a middleware answering a non-2xx 0.5 Response without calling next keeps it', async () => {
    class Throttle extends Middleware {
      async handle() { return new LaratypeResponse({ message: 'Too Many Requests' }, 429, { 'Retry-After': '60' }) }
    }
    const app = new Hono()
    Route.api(usersApi, (r) => [r.middleware(Throttle).contract(users, UserController)]).mount(app)
    const response = await app.request('/api/users/1')
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(await response.json()).toEqual({ message: 'Too Many Requests' })
  })

  it('a middleware\'s 0.5 Response with no content, or a 304, keeps its status', async () => {
    let answer = new LaratypeResponse(null, 401, { 'WWW-Authenticate': 'Bearer' })
    class Guard extends Middleware {
      async handle() { return answer }
    }
    const app = new Hono()
    Route.api(usersApi, (r) => [r.middleware(Guard).contract(users, UserController)]).mount(app)
    const denied = await app.request('/api/users/1')
    expect(denied.status).toBe(401)
    expect(denied.headers.get('www-authenticate')).toBe('Bearer')
    answer = new LaratypeResponse({}, 304, { ETag: '"v1"', 'Content-Type': 'text/html' })
    const cached = await app.request('/api/users/1')
    expect(cached.status).toBe(304)
    expect(cached.headers.get('etag')).toBe('"v1"')
    // a bodyless 304 carries no body, so no Content-Type either (H32 #312)
    expect(cached.headers.get('content-type')).toBeNull()
    expect(await cached.text()).toBe('')
  })

  it('a bodyless answer drops the handler\'s Content-Type', async () => {
    const jobs = defineContract()({ queue: endpoint.post('/').status(202) })
    class Jobs extends Controller { queue() { return new LaratypeResponse('queued', undefined, { 'Content-Type': 'text/html', 'X-Job': '7' }) } }
    const app = new Hono()
    Route.api(defineApi({ jobs: { contract: jobs, path: '/api/jobs', scopes: [], dirs: [] } }), (r) => [r.contract(jobs, Jobs)]).mount(app)
    const response = await app.request('/api/jobs', { method: 'POST' })
    expect(response.status).toBe(202)
    expect(response.headers.get('content-type')).toBeNull()
    expect(response.headers.get('x-job')).toBe('7')
  })

  it('the handler\'s body headers are dropped: they describe its body, not the JSON sent', async () => {
    result = new LaratypeResponse({ id: 5, name: 'Edsger' }, 200, {
      'Content-Encoding': 'gzip',
      'Content-Length': '120',
      'Content-Disposition': 'attachment; filename="user.json"',
      'X-Foo': 'bar',
    })
    const response = await bootApp().request('/api/users/5')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('content-disposition')).toBeNull()
    expect(response.headers.get('content-type')).toMatch(/^application\/json/)
    expect(response.headers.get('x-foo')).toBe('bar')
    expect(await response.json()).toEqual({ id: 5, name: 'Edsger' })
  })

  it('a 204 drops the handler\'s body headers too', async () => {
    const deletes = defineContract()({ destroy: endpoint.delete('/:id') })
    class Deletes extends Controller {
      destroy() { return new LaratypeResponse({ deleted: true }, undefined, { 'Content-Length': '120', 'Content-Encoding': 'gzip', 'X-Foo': 'bar' }) }
    }
    const app = new Hono()
    Route.api(defineApi({ deletes: { contract: deletes, path: '/api/deletes', scopes: [], dirs: [] } }), (r) => [r.contract(deletes, Deletes)]).mount(app)
    const response = await app.request('/api/deletes/1', { method: 'DELETE' })
    expect(response.status).toBe(204)
    expect(response.headers.get('content-length')).toBeNull()
    expect(response.headers.get('content-encoding')).toBeNull()
    expect(response.headers.get('x-foo')).toBe('bar')
    expect(await response.text()).toBe('')
  })
})

describe('Location on a contract response', () => {
  // RFC 9110 §15.3.2: a 201 Created names the created resource in Location, which is not about the body
  it('a 201 Created keeps the handler\'s Location and Content-Location', async () => {
    // a header name is case-insensitive
    result = new LaratypeResponse({ id: 6, name: 'Ada' }, 201, {
      location: '/api/users/6',
      'cOnTeNt-LoCaTiOn': '/api/users/6',
    })
    const response = await bootApp().request('/api/users/create', { method: 'POST' })
    expect(response.status).toBe(201)
    expect(response.headers.get('location')).toBe('/api/users/6')
    // RFC 9110 §8.7: the resource the representation is about, kept like Location on a 201
    expect(response.headers.get('content-location')).toBe('/api/users/6')
    expect(await response.json()).toEqual({ id: 6, name: 'Ada' })
  })

  it('a 201 Response without an explicit status keeps them too: the endpoint decides the status', async () => {
    result = new LaratypeResponse({ id: 6, name: 'Ada' }, undefined, {
      Location: '/api/users/6',
      'Content-Location': '/api/users/6',
      'X-Foo': 'bar',
    })
    const response = await bootApp().request('/api/users/create', { method: 'POST' })
    expect(response.status).toBe(201)
    expect(response.headers.get('location')).toBe('/api/users/6')
    expect(response.headers.get('content-location')).toBe('/api/users/6')
    expect(response.headers.get('x-foo')).toBe('bar')
    expect(await response.json()).toEqual({ id: 6, name: 'Ada' })
  })

  it('a 200 drops them with the other body headers', async () => {
    result = new LaratypeResponse({ id: 1, name: 'Ada' }, 200, { Location: '/api/users/1', 'Content-Location': '/api/users/1', 'X-Foo': 'bar' })
    const response = await bootApp().request('/api/users/1')
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('content-location')).toBeNull()
    expect(response.headers.get('x-foo')).toBe('bar')
    expect(await response.json()).toEqual({ id: 1, name: 'Ada' })
  })

  it('an error response drops the Location a 201 had set', async () => {
    // a middleware that throws after the route answered through resolveContractResponse
    const app = bootApp((app) => {
      app.use(async (_c, next) => {
        await next()
        throw new Error('secret detail')
      })
    })
    result = new LaratypeResponse({ id: 6, name: 'Ada' }, 201, { Location: '/api/users/6' })
    const response = await app.request('/api/users/create', { method: 'POST' })
    expect(response.status).toBe(500)
    expect(response.headers.get('location')).toBeNull()
    expect(await response.json()).toEqual({ message: 'Server Error' })
  })

  it('a thrown contract error after a declared-201 handler set Location drops it', async () => {
    // H32 #312: the test guards the order of the filter, which deletes the body and redirect headers before the
    // contract-error branch builds its own body
    const Conflict = defineError(409, 'CONFLICT', () => ({ message: 'Taken.' }))
    const creates = defineContract()({ store: endpoint.post('/').response(User, 201).throws(Conflict) })
    class Creates extends Controller {
      store() {
        return new LaratypeResponse({ id: 6, name: 'Ada' }, undefined, {
          Location: '/api/creates/6',
          'Content-Location': '/api/creates/6',
        })
      }
    }
    const app = bootApp((app) => app.use(async (_c, next) => {
      await next()
      throw Conflict()
    }))
    Route.api(defineApi({ creates: { contract: creates, path: '/api/creates', scopes: [], dirs: [] } }), (r) => [r.contract(creates, Creates)]).mount(app)
    const response = await app.request('/api/creates', { method: 'POST' })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'CONFLICT', message: 'Taken.' })
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('content-location')).toBeNull()
  })
})

describe('JSON serialization', () => {
  it('a Date is sent as its ISO string (the client reads Jsonify<output>)', async () => {
    const response = await bootApp().request('/api/users/1/joined')
    expect(await response.json()).toEqual({ at: '2026-10-22T00:00:00.000Z' })
  })

  it('a JsonResource is unwrapped', async () => {
    result = new JsonResource({ id: 4, name: 'Barbara' })
    expect(await (await bootApp().request('/api/users/4')).json()).toEqual({ id: 4, name: 'Barbara' })
  })

  it('a string is sent as a JSON string, not as HTML', async () => {
    const strings = defineContract()({ index: endpoint.get('/').response(z.string()) })
    class Strings extends Controller { index() { return '<b>hi</b>' } }
    const app = new Hono()
    Route.api(defineApi({ strings: { contract: strings, path: '/api/strings', scopes: [], dirs: [] } }), (r) => [r.contract(strings, Strings)]).mount(app)
    const response = await app.request('/api/strings')
    expect(response.headers.get('content-type')).toMatch(/^application\/json/)
    expect(await response.text()).toBe('"<b>hi</b>"')
  })
})

describe('dev-mode output validation', () => {
  it('a value that does not match the response schema answers a generic 500 and logs the issues', async () => {
    result = { id: '1', name: 'Ada', password: 'secret' }
    const response = await bootApp().request('/api/users/1', { method: 'PUT' })
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ message: 'Server Error' })
    expect(text).not.toContain('secret')
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/^\[@laratype\/http\] users\.update: the handler's value does not match the endpoint's response schema \(id: /),
    }))
  })

  it('the 500 of a failed check carries none of the handler\'s headers', async () => {
    result = new LaratypeResponse({ id: 'x' }, undefined, { 'Set-Cookie': 'a=b', 'Cache-Control': 'public, max-age=3600' })
    const response = await bootApp().request('/api/users/1')
    expect(response.status).toBe(500)
    expect(response.headers.get('set-cookie')).toBeNull()
    // The error's own Cache-Control, not the handler's (#272, H23)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('a missing value fails the check (an empty answer would be null)', async () => {
    result = undefined
    expect((await bootApp().request('/api/users/1')).status).toBe(500)
  })

  it('a key the schema strips fails the check: it would be sent, but the client type leaves it out', async () => {
    result = { id: 1, name: 'Ada', passwordHash: 'secret' }
    const response = await bootApp().request('/api/users/1')
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('secret')
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({
      message: "[@laratype/http] users.show: the endpoint's response schema changes the handler's value (a transform, or a key it strips), so the client's type would not match what is sent: return the schema's output",
    }))
  })

  it('a transforming schema fails the check; key order and Dates do not', async () => {
    const ids = defineContract()({
      show: endpoint.get('/:id').response(z.object({ id: z.number().transform(String) })),
      index: endpoint.get('/').response(z.object({ a: z.number(), at: z.date() })),
    })
    class Ids extends Controller {
      show() { return { id: 1 } }
      index() { return { at: new Date(0), a: 1 } }
    }
    const app = new Hono()
    Route.api(defineApi({ ids: { contract: ids, path: '/api/ids', scopes: [], dirs: [] } }), (r) => [r.contract(ids, Ids)]).mount(app)
    expect((await app.request('/api/ids/1')).status).toBe(500)
    expect(await (await app.request('/api/ids')).json()).toEqual({ at: '1970-01-01T00:00:00.000Z', a: 1 })
  })

  it('the response schema runs once (zod\'s safeParseAsync, never its twice-running validate)', async () => {
    // H32 #312: an async refinement is what makes zod's `~standard.validate` run the schema a second time; the
    // contract's adapter takes safeParseAsync for zod, so a side effect runs once
    let calls = 0
    const once = defineContract()({
      show: endpoint.get('/:id').response(z.object({ id: z.number() }).superRefine(async () => { calls++ })),
    })
    class Once extends Controller { show() { return { id: 1 } } }
    const app = new Hono()
    Route.api(defineApi({ once: { contract: once, path: '/api/once', scopes: [], dirs: [] } }), (r) => [r.contract(once, Once)]).mount(app)
    const response = await app.request('/api/once/1')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 1 })
    expect(calls).toBe(1)
  })

  it('is skipped in production (__PROD__, or NODE_ENV=production without it)', async () => {
    vi.stubGlobal('__PROD__', true)
    result = { id: '1', passwordHash: 'h' }
    const prod = await bootApp().request('/api/users/1')
    expect(prod.status).toBe(200)
    expect(await prod.json()).toEqual({ id: '1', passwordHash: 'h' })

    vi.stubGlobal('__PROD__', undefined)
    vi.stubEnv('NODE_ENV', 'production')
    expect((await bootApp().request('/api/users/1')).status).toBe(200)
    result = undefined
    const empty = await bootApp().request('/api/users/1')
    expect(empty.status).toBe(200)
    expect(await empty.text()).toBe('null')
  })

  it('a value JSON.stringify throws on is a 500 without the handler\'s headers, in production too', async () => {
    vi.stubGlobal('__PROD__', true)
    result = new LaratypeResponse({ id: 1n }, undefined, { 'Set-Cookie': 'sid=x' })
    const response = await bootApp().request('/api/users/1')
    expect(response.status).toBe(500)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})

describe('0.5 routes', () => {
  it('keep their method-name status', async () => {
    class Legacy extends Controller { store() { return { ok: true } } }
    const app = bootApp()
    app.post('/legacy', RequestKernel.handle({ method: 'post', path: '/legacy', request: LaratypeRequest, controller: [Legacy, 'store'] }))
    expect((await app.request('/legacy', { method: 'POST' })).status).toBe(201)
  })
})
