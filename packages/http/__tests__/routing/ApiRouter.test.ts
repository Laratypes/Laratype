// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { defineApi, defineContract, defineScope, endpoint } from '@laratype/contract'
import type { ContractPrefix } from '@laratype/contract'
import { ApiRoutes, Controller, Middleware, Route } from '../../src/index'

// A small tree, as `sauf types:generate` emits it for:
//   app/api/_scope.ts                    { auth: true }
//   app/api/users.ts                     /api/users
//   app/api/users/[user]/_scope.ts       { authorize: true }
//   app/api/users/[user]/posts.ts        /api/users/:user/posts
const root = defineScope()({ auth: true })
const usersUser = defineScope<ContractPrefix<'/api/users/:user', [typeof root]>>()({ authorize: true })
const users = defineContract()({ index: endpoint.get('/'), show: endpoint.get('/:id') })
const posts = defineContract()({ index: endpoint.get('/'), store: endpoint.post('/') })
const appApi = defineApi({
  users: { contract: users, path: '/api/users', scopes: [root], dirs: [''] },
  'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [root, usersUser], dirs: ['', 'users/[user]'] },
})

class UserController extends Controller {
  index() { return { users: ['ada'] } }
  show(req: { param(key: string): string }) { return { id: req.param('id') } }
}

class PostController extends Controller {
  index(req: { param(key: string): string }) { return { user: req.param('user'), posts: [] } }
  store() { return { created: true } }
}

class UserScopePolicy {}

class Audit extends Middleware {}
class Trace extends Middleware {}

const mount = (routes: ApiRoutes) => {
  const app = new Hono()
  return { app, entries: routes.mount(app) }
}

afterEach(() => {
  vi.restoreAllMocks()
})

beforeAll(() => {
  // RequestKernel.boot() sets this in an app; the router runs the 0.5 kernel until H2/H3
  globalThis.__laratype_route_model_bindings = {}
})

describe('Route.api', () => {
  const routes = Route.api(appApi, (r) => [
    r.contract(users, UserController),
    r.middleware(Audit).scope('users/[user]', { policy: UserScopePolicy }),
    r.middleware(Trace).contract(posts, PostController),
  ])

  it('serves every contract route at the URL of its folder, [x] folders included', async () => {
    const { app } = mount(routes)
    expect(await (await app.request('/api/users')).json()).toEqual({ users: ['ada'] })
    expect(await (await app.request('/api/users/7')).json()).toEqual({ id: '7' })
    expect(await (await app.request('/api/users/7/posts')).json()).toEqual({ user: '7', posts: [] })
    const created = await app.request('/api/users/7/posts', { method: 'POST' })
    expect(created.status).toBe(201)
    expect(await created.json()).toEqual({ created: true })
    expect((await app.request('/api/posts')).status).toBe(404)
  })

  it('returns one registry entry per route: name, method, path, endpoint, controller, middleware, policies', () => {
    const { entries } = mount(routes)
    expect(entries.map((e) => [e.name, e.method, e.path])).toEqual([
      ['users.index', 'get', '/api/users'],
      ['users.show', 'get', '/api/users/:id'],
      ['users.posts.index', 'get', '/api/users/:user/posts'],
      ['users.posts.store', 'post', '/api/users/:user/posts'],
    ])
    const store = entries[3]!
    expect(store.endpoint).toBe(posts.store)
    expect(store.contract).toBe(posts)
    expect(store.controller).toEqual([PostController, 'store'])
    expect(store.middleware).toEqual([Audit, Trace])
    expect(store.policies).toEqual([{ dir: 'users/[user]', policy: UserScopePolicy }])
    expect(store.scopes).toEqual([root, usersUser])
    expect(store.authorize).toBe(true)
    expect(store.domain).toBeUndefined()
    expect(entries[0]!.policies).toEqual([])
    expect(entries[0]!.middleware).toEqual([])
    expect(routes.routes).toEqual(entries)
  })

  it('.domain() matches the hostname and ignores the port; other hosts fall through', async () => {
    const app = new Hono()
    const entries = routes.domain('API.example.test').mount(app)
    app.get('/api/users', (c) => c.text('fallback'))
    expect(entries.every((e) => e.domain === 'api.example.test')).toBe(true)
    expect(await (await app.request('http://api.example.test:3000/api/users')).json()).toEqual({ users: ['ada'] })
    expect(await (await app.request('http://api.example.test/api/users/1/posts')).json()).toEqual({ user: '1', posts: [] })
    expect(await (await app.request('http://other.test/api/users')).text()).toBe('fallback')
    expect((await app.request('http://other.test:3000/api/users/1')).status).toBe(404)
  })

  it('rejects a domain that is not a hostname', () => {
    expect(() => routes.domain('https://api.example.test')).toThrow(/\.domain\("https:\/\/api.example.test"\) must be a hostname/)
    expect(() => routes.domain('api.example.test:3000')).toThrow(/must be a hostname/)
  })
})

describe('auth and authorize are not enforced yet', () => {
  it('mount() warns once, listing the routes with auth or authorize', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount(Route.api(appApi, (r) => [
      r.contract(users, UserController),
      r.scope('users/[user]', { policy: UserScopePolicy }),
      r.contract(posts, PostController),
    ]))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      '[@laratype/http] Route.api: auth and authorize are not enforced yet (planned → #105, #121), so these routes serve every request: ' +
        'users.index (auth), users.show (auth), users.posts.index (auth, authorize), users.posts.store (auth, authorize)',
    )
  })

  it('no warning without auth or authorize', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const open = defineContract()({ ping: endpoint.get('/') })
    class Ping extends Controller { ping() { return 'pong' } }
    mount(Route.api(defineApi({ ping: { contract: open, path: '/ping', scopes: [], dirs: [] } }), (r) => [r.contract(open, Ping)]))
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('Route.api runtime checks', () => {
  const api = (build: (r: any) => unknown[]) => () => Route.api(appApi as any, build as never)

  it('a contract that is not mounted', () => {
    expect(api((r) => [r.contract(users, UserController), r.scope('users/[user]', { policy: UserScopePolicy })])).toThrow(
      '[@laratype/http] Route.api: contract "users.posts" is not mounted (add r.contract())',
    )
  })

  it('a contract mounted twice', () => {
    expect(api((r) => [
      r.contract(users, UserController),
      r.contract(posts, PostController),
      r.contract(users, UserController),
      r.scope('users/[user]', { policy: UserScopePolicy }),
    ])).toThrow('contract "users" is mounted twice')
  })

  it('a contract that is not in the tree', () => {
    const other = defineContract()({ index: endpoint.get('/') })
    expect(api((r) => [r.contract(other, UserController)])).toThrow('a mounted contract is not in the API tree')
  })

  it('a scope with authorize and no policy', () => {
    expect(api((r) => [r.contract(users, UserController), r.contract(posts, PostController)])).toThrow(
      `scope "users/[user]" has authorize but no policy (add r.scope('users/[user]', { policy }))`,
    )
  })

  it('a scope mounted twice, an unknown folder, a scope without a policy', () => {
    const base = (r: any) => [r.contract(users, UserController), r.contract(posts, PostController)]
    expect(api((r) => [...base(r), r.scope('users/[user]', { policy: UserScopePolicy }), r.scope('users/[user]', { policy: UserScopePolicy })])).toThrow(
      'scope "users/[user]" is mounted twice',
    )
    expect(api((r) => [...base(r), r.scope('users', { policy: UserScopePolicy })])).toThrow(
      '"users" is not a scope folder of the API tree (folders: "", "users/[user]")',
    )
    expect(api((r) => [...base(r), r.scope('users/[user]', {})])).toThrow(`r.scope('users/[user]') needs { policy }`)
  })

  it('a controller without the endpoint method', () => {
    class Partial extends Controller { index() { return [] } }
    expect(api((r) => [r.contract(users, Partial), r.contract(posts, PostController), r.scope('users/[user]', { policy: UserScopePolicy })])).toThrow(
      'users.show: Partial has no method "show" (handlers must be class methods, not arrow-function fields)',
    )
  })

  it('an arrow-function field is not a handler', () => {
    class Arrows extends Controller { index = () => []; show() { return {} } }
    expect(api((r) => [r.contract(users, Arrows), r.contract(posts, PostController), r.scope('users/[user]', { policy: UserScopePolicy })])).toThrow(
      'users.index: Arrows has no method "index" (handlers must be class methods, not arrow-function fields)',
    )
  })

  it('an undefined controller (a circular import) names the contract', () => {
    expect(api((r) => [r.contract(users, UserController), r.contract(posts, undefined), r.scope('users/[user]', { policy: UserScopePolicy })])).toThrow(
      '[@laratype/http] Route.api: contract "users.posts": r.contract() got undefined as its controller (a circular import?)',
    )
  })

  it('a value that is not a defineApi tree', () => {
    expect(() => Route.api({ users: { index: 1 } } as any, (() => []) as never)).toThrow('expected the appApi tree built with defineApi')
    expect(() => Route.api({ users } as any, (() => []) as never)).toThrow('expected the appApi tree built with defineApi')
  })

  it('an empty tree mounts nothing', () => {
    expect(Route.api(defineApi({}), () => []).routes).toEqual([])
  })
})
