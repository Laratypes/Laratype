// H4 #107: a Route.api route answers with its endpoint's status and a JSON body, checked against the response schema in dev
import 'reflect-metadata'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, JsonResource, Request as LaratypeRequest, RequestKernel, Response as LaratypeResponse, ResponseKernel, Route } from '../../src/index'

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
}

/** An app booted like `sauf dev`: RequestKernel puts the container on each request, ResponseKernel handles errors. */
const bootApp = () => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  Route.api(usersApi, (r) => [r.contract(users, UserController)]).mount(app)
  return app
}

let errors: ReturnType<typeof vi.spyOn>

beforeAll(() => {
  globalThis.__laratype_route_model_bindings = {}
})

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

  it('a 0.5 redirect is sent as it is', async () => {
    result = new LaratypeResponse(null).redirect('/login')
    const response = await bootApp().request('/api/users/1')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/login')
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

  it('a missing value fails the check (an empty answer would be null)', async () => {
    result = undefined
    expect((await bootApp().request('/api/users/1')).status).toBe(500)
  })

  it('sends the handler\'s value, not the schema\'s parsed one', async () => {
    result = { id: 1, name: 'Ada', extra: true }
    expect(await (await bootApp().request('/api/users/1')).json()).toEqual({ id: 1, name: 'Ada', extra: true })
  })

  it('is skipped in production (__PROD__, or NODE_ENV=production without it)', async () => {
    result = { id: '1' }
    vi.stubGlobal('__PROD__', true)
    const prod = await bootApp().request('/api/users/1')
    expect(prod.status).toBe(200)
    expect(await prod.json()).toEqual({ id: '1' })

    vi.stubGlobal('__PROD__', undefined)
    vi.stubEnv('NODE_ENV', 'production')
    expect((await bootApp().request('/api/users/1')).status).toBe(200)
    result = undefined
    const empty = await bootApp().request('/api/users/1')
    expect(empty.status).toBe(200)
    expect(await empty.text()).toBe('null')
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
