// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { apiRoutes, defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Middleware, Route } from '../../src/index'
import type { ApiRoutes } from '../../src/index'

// Ad-hoc routes (H12 #139): `r.get('/health', () => 'ok')` next to the contract routes of a Route.api group
const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const
const users = defineContract()({ show: endpoint.get('/:id').response(anything) })
const appApi = defineApi({ users: { contract: users, path: '/api/users', scopes: [], dirs: [] } })

class UserController extends Controller {
  show(req: { param(key: string): string }) { return { id: req.param('id') } }
}

const calls: string[] = []
class Audit extends Middleware {
  async handle(request: any, res: Response, next: (request: any) => unknown) {
    calls.push('audit')
    return next(request)
  }
}

const mount = (routes: ApiRoutes) => {
  const app = new Hono()
  return { app, entries: routes.mount(app) }
}

beforeAll(() => {
  // RequestKernel.boot() sets this in an app
  globalThis.__laratype_route_model_bindings = {}
})

afterEach(() => {
  calls.length = 0
  vi.restoreAllMocks()
})

describe('ad-hoc routes', () => {
  const routes = Route.api(appApi, (r) => [
    r.contract(users, UserController),
    r.get('/health', () => 'ok'),
    r.get('/hello/:name', (req, { name }) => ({ hello: name })),
    r.post('/echo', async (req) => ({ echo: req.input('text') })),
    r.put('/items/:id', (req, { id }) => ({ put: id })),
    r.patch('/items/:id', (req, { id }) => ({ patch: id })),
    r.delete('/items/:id', (req, { id }) => ({ delete: id })),
    r.middleware(Audit).get('/audited', () => ({ audited: true })),
  ])

  it('serves the handler result as a controller method result, at the path as written', async () => {
    const { app } = mount(routes)
    const health = await app.request('/health')
    expect(health.status).toBe(200)
    expect(await health.text()).toBe('ok')
    expect(await (await app.request('/hello/ada')).json()).toEqual({ hello: 'ada' })
    expect(await (await app.request('/api/users/7')).json()).toEqual({ id: '7' })
  })

  it('serves every method', async () => {
    const { app } = mount(routes)
    const echo = await app.request('/echo', { method: 'POST', body: JSON.stringify({ text: 'hi' }), headers: { 'Content-Type': 'application/json' } })
    expect(echo.status).toBe(200)
    expect(await echo.json()).toEqual({ echo: 'hi' })
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(await (await app.request('/items/3', { method })).json()).toEqual({ [method.toLowerCase()]: '3' })
    }
    expect((await app.request('/health', { method: 'POST' })).status).toBe(404)
  })

  it('runs the middleware of the builder', async () => {
    const { app } = mount(routes)
    expect(await (await app.request('/audited')).json()).toEqual({ audited: true })
    expect(calls).toEqual(['audit'])
    await app.request('/health')
    expect(calls).toEqual(['audit'])
  })

  it('passes the raw path params, with no 0.5 model binding', async () => {
    const lookup = vi.fn(() => ({ bound: true }))
    globalThis.__laratype_route_model_bindings = { name: lookup }
    try {
      const { app } = mount(routes)
      expect(await (await app.request('/hello/ada')).json()).toEqual({ hello: 'ada' })
      expect(lookup).not.toHaveBeenCalled()
    } finally {
      globalThis.__laratype_route_model_bindings = {}
    }
  })

  it('keeps ad-hoc routes out of the contract routes, so OpenAPI and typegen never see them', () => {
    const { entries } = mount(routes)
    expect(routes.routes.map((e) => e.name)).toEqual(['users.show'])
    expect(apiRoutes(appApi).map((e) => e.name)).toEqual(['users.show'])
    expect(routes.adHoc.map((e) => [e.method, e.path])).toEqual([
      ['get', '/health'], ['get', '/hello/:name'], ['post', '/echo'], ['put', '/items/:id'], ['patch', '/items/:id'], ['delete', '/items/:id'], ['get', '/audited'],
    ])
    // The registry: the contract routes, then the ad-hoc ones, which have no name or controller
    expect(entries).toEqual([...routes.routes, ...routes.adHoc])
    const audited = routes.adHoc[6]!
    expect(audited).toEqual({ method: 'get', path: '/audited', name: undefined, controller: undefined, handler: expect.any(Function), middleware: [Audit], domain: undefined })
    expect(Object.isFrozen(audited)).toBe(true)
  })

  it('registers ad-hoc and contract routes by specificity', async () => {
    const { app } = mount(Route.api(appApi, (r) => [r.contract(users, UserController), r.get('/api/users/me', () => ({ me: true }))]))
    expect(await (await app.request('/api/users/me')).json()).toEqual({ me: true })
    expect(await (await app.request('/api/users/7')).json()).toEqual({ id: '7' })
  })

  it('.domain() applies to ad-hoc routes', async () => {
    const scoped = routes.domain('api.example.test')
    expect(scoped.adHoc.every((e) => e.domain === 'api.example.test')).toBe(true)
    const { app } = mount(scoped)
    expect(await (await app.request('http://api.example.test/health')).text()).toBe('ok')
    expect((await app.request('http://other.example.test/health')).status).toBe(404)
  })

  it('still needs every contract of the tree', () => {
    expect(() => Route.api(appApi, (r) => [r.get('/health', () => 'ok')] as never)).toThrow(
      '[@laratype/http] Route.api: contract "users" is not mounted (add r.contract())',
    )
  })

  it('rejects an ad-hoc route that repeats a contract route or another ad-hoc route', () => {
    expect(() => Route.api(appApi, (r) => [r.contract(users, UserController), r.get('/api/users/:id', () => 'shadowed')])).toThrow(
      "[@laratype/http] Route.api: r.get('/api/users/:id') is the same route as users.show",
    )
    expect(() => Route.api(appApi, (r) => [r.contract(users, UserController), r.get('/health', () => 'a'), r.get('/health', () => 'b')])).toThrow(
      "[@laratype/http] Route.api: r.get('/health') is the same route as another r.get('/health')",
    )
    // Another method on the same path is another route
    expect(() => Route.api(appApi, (r) => [r.contract(users, UserController), r.get('/health', () => 'a'), r.post('/health', () => 'b')])).not.toThrow()
  })

  it('rejects a path without a leading "/" and a missing handler', () => {
    expect(() => Route.api(appApi, (r) => [r.contract(users, UserController), r.get('health' as '/health', () => 'ok')])).toThrow(
      "[@laratype/http] Route.api: r.get('health'): the path must start with \"/\"",
    )
    expect(() => Route.api(appApi, (r) => [r.contract(users, UserController), r.post('/echo', undefined as never)])).toThrow(
      "[@laratype/http] Route.api: r.post('/echo') needs a handler function",
    )
  })
})
