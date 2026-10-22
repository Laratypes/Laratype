// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { defineApi, defineContract, defineScope, endpoint } from '@laratype/contract'
import type { ContractPrefix } from '@laratype/contract'
import { Controller, Middleware, Route, UNENFORCED_NOTICE } from '../../src/index'
import type { ApiRoutes } from '../../src/index'

// A small tree, as `sauf types:generate` emits it for:
//   app/api/_scope.ts                    { auth: true }
//   app/api/users.ts                     /api/users
//   app/api/users/[user]/_scope.ts       { authorize: true }
//   app/api/users/[user]/posts.ts        /api/users/:user/posts
const root = defineScope()({ auth: true })
const usersUser = defineScope<ContractPrefix<'/api/users/:user', [typeof root]>>()({ authorize: true })
const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const
// Endpoints that answer with a JSON body declare a response schema: without one the status is 204 (CL2)
const users = defineContract()({ index: endpoint.get('/').response(anything), show: endpoint.get('/:id').response(anything) })
const posts = defineContract()({ index: endpoint.get('/').response(anything), store: endpoint.post('/').response(anything, 201) })
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

  it("a parent's param route does not shadow a child's static route (registered by specificity)", async () => {
    // app/api/users.ts { show: '/:user' } and app/api/users/me.ts { index: '/' }: tree order registers /api/users/:user first
    const usersShow = defineContract()({ show: endpoint.get('/:user').response(anything) })
    const usersMe = defineContract()({ index: endpoint.get('/').response(anything) })
    const tree = defineApi({
      users: { contract: usersShow, path: '/api/users', scopes: [], dirs: [] },
      'users.me': { contract: usersMe, path: '/api/users/me', scopes: [], dirs: [] },
    })
    class UsersController extends Controller { show(_req: unknown, { user }: { user: string }) { return { show: user } } }
    class MeController extends Controller { index() { return { me: true } } }
    const routes = Route.api(tree, (r) => [r.contract(usersShow, UsersController), r.contract(usersMe, MeController)])
    const { app, entries } = mount(routes)
    expect(await (await app.request('/api/users/me')).json()).toEqual({ me: true })
    expect(await (await app.request('/api/users/ada')).json()).toEqual({ show: 'ada' })
    // the registry keeps the tree order
    expect(entries.map((e) => e.name)).toEqual(['users.show', 'users.me.index'])
  })

  it('a regex param that can span segments ranks after a plain param, so it does not catch a child route', async () => {
    // app/api/files.ts { show: '/:path{.+}' } and app/api/files/[id]/raw.ts { index: '/' }
    const files = defineContract()({ show: endpoint.get('/:path{.+}').response(anything) })
    const raw = defineContract()({ index: endpoint.get('/').response(anything) })
    const tree = defineApi({
      files: { contract: files, path: '/api/files', scopes: [], dirs: [] },
      'files.raw': { contract: raw, path: '/api/files/:id/raw', scopes: [], dirs: [] },
    })
    class FilesController extends Controller { show(_req: unknown, { path }: { path: string }) { return { path } } }
    class RawController extends Controller { index(_req: unknown, { id }: { id: string }) { return { raw: id } } }
    const { app } = mount(Route.api(tree, (r) => [r.contract(files, FilesController), r.contract(raw, RawController)]))
    expect(await (await app.request('/api/files/42/raw')).json()).toEqual({ raw: '42' })
    expect(await (await app.request('/api/files/a/b.txt')).json()).toEqual({ path: 'a/b.txt' })
  })

  it('a param constrained to one segment ranks before a plain param at the same position', async () => {
    // /api/posts/:slug and /api/posts/:id{[0-9]+}: the slug route comes first in tree order
    const bySlug = defineContract()({ show: endpoint.get('/:slug').response(anything) })
    const byId = defineContract()({ show: endpoint.get('/:id{[0-9]+}').response(anything) })
    const tree = defineApi({
      slugs: { contract: bySlug, path: '/api/posts', scopes: [], dirs: [] },
      ids: { contract: byId, path: '/api/posts', scopes: [], dirs: [] },
    })
    class SlugController extends Controller { show(_req: unknown, { slug }: { slug: string }) { return { slug } } }
    class IdController extends Controller { show(_req: unknown, { id }: { id: string }) { return { id } } }
    const { app } = mount(Route.api(tree, (r) => [r.contract(bySlug, SlugController), r.contract(byId, IdController)]))
    expect(await (await app.request('/api/posts/42')).json()).toEqual({ id: '42' })
    expect(await (await app.request('/api/posts/abc')).json()).toEqual({ slug: 'abc' })
  })

  it('a tree node mounts its contract, so two contracts of the same shape can be told apart', async () => {
    const postsOnly = defineContract()({ index: endpoint.get('/').response(anything) })
    const comments = defineContract()({ index: endpoint.get('/').response(anything) })
    const twins = defineApi({
      posts: { contract: postsOnly, path: '/api/posts', scopes: [], dirs: [] },
      comments: { contract: comments, path: '/api/comments', scopes: [], dirs: [] },
    })
    class PostsController extends Controller { index() { return { from: 'posts' } } }
    class CommentsController extends Controller { index() { return { from: 'comments' } } }
    const { app } = mount(Route.api(twins, (r) => [r.contract(twins.posts, PostsController), r.contract(twins.comments, CommentsController)]))
    expect(await (await app.request('/api/posts')).json()).toEqual({ from: 'posts' })
    expect(await (await app.request('/api/comments')).json()).toEqual({ from: 'comments' })
    expect(() => Route.api(twins, (r) => [r.contract(twins.posts, PostsController)] as never)).toThrow('contract "comments" is not mounted')
    expect(() =>
      Route.api(twins, (r) => [r.contract(twins.posts, PostsController), r.contract(postsOnly, PostsController), r.contract(twins.comments, CommentsController)] as never),
    ).toThrow('contract "posts" is mounted twice')
  })

  it('a folder node or a node of another tree is not in the API tree', () => {
    const other = defineApi({ users: { contract: users, path: '/api/users', scopes: [], dirs: [] } })
    const folders = defineApi({ 'v1.health': { contract: posts, path: '/api/v1/health', scopes: [], dirs: [] } })
    expect(() => Route.api(appApi, (r) => [r.contract(other.users, UserController)] as never)).toThrow('a mounted contract is not in the API tree')
    expect(() => Route.api(folders, (r) => [r.contract(folders.v1, PostController)] as never)).toThrow('a mounted contract is not in the API tree')
  })

  it('answers with the endpoint status, not one guessed from the method name', async () => {
    const gone = defineContract()({
      destroy: endpoint.delete('/:id').response(anything),
      store: endpoint.post('/').response(anything),
      ping: endpoint.get('/ping'),
      queue: endpoint.post('/queue').status(202).response(anything),
    })
    class Gone extends Controller { destroy() { return { ok: true } } store() { return { ok: true } } ping() { return { ignored: true } } queue() { return { queued: true } } }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { app } = mount(Route.api(defineApi({ gone: { contract: gone, path: '/gone', scopes: [], dirs: [] } }), (r) => [r.contract(gone, Gone as never)]))
    // the 0.5 kernel would guess 204 for destroy and 201 for store
    expect((await app.request('/gone/1', { method: 'DELETE' })).status).toBe(200)
    expect((await app.request('/gone', { method: 'POST' })).status).toBe(200)
    // no response schema: 204 with no body (CL2's default), even when the handler returns one (Gone and Reset return a
    // body the route proof rejects, so they are cast)
    const ping = await app.request('/gone/ping')
    expect(ping.status).toBe(204)
    expect(await ping.text()).toBe('')
    // 205 Reset Content has no body either
    const reset = defineContract()({ clear: endpoint.post('/').status(205) })
    class Reset extends Controller { clear() { return { ignored: true } } }
    const { app: resetApp } = mount(Route.api(defineApi({ reset: { contract: reset, path: '/reset', scopes: [], dirs: [] } }), (r) => [r.contract(reset, Reset as never)]))
    const cleared = await resetApp.request('/reset', { method: 'POST' })
    expect(cleared.status).toBe(205)
    expect(await cleared.text()).toBe('')
    // .status(n) before .response()
    const queued = await app.request('/gone/queue', { method: 'POST' })
    expect(queued.status).toBe(202)
    expect(await queued.json()).toEqual({ queued: true })
  })

  it('checks a status decorator against the 204 default and .status(n)', () => {
    const quiet = defineContract()({ remove: endpoint.delete('/:id'), accept: endpoint.post('/').status(202) })
    const quietApi = defineApi({ quiet: { contract: quiet, path: '/quiet', scopes: [], dirs: [] } })
    class Quiet extends Controller { remove() {} accept() {} }
    // a decorator saying 204 matches the schema-less default
    Reflect.defineMetadata('laratype:controller_status_code', 204, Quiet.prototype, 'remove')
    Reflect.defineMetadata('laratype:controller_status_code', 202, Quiet.prototype, 'accept')
    expect(() => Route.api(quietApi, (r) => [r.contract(quiet, Quiet)])).not.toThrow()
    Reflect.defineMetadata('laratype:controller_status_code', 200, Quiet.prototype, 'remove')
    expect(() => Route.api(quietApi, (r) => [r.contract(quiet, Quiet)])).toThrow(
      'quiet.remove: Quiet.remove has status 200 from its status decorator, but the endpoint declares 204',
    )
  })

  it('contract routes get the raw path params: no 0.5 implicit or Route.model binding', async () => {
    const lookups: string[] = []
    const g = globalThis as Record<string, unknown>
    const saved = { bindings: g.__laratype_route_model_bindings, map: g.__laratype_param_model_map }
    // a resolver bound to the param name, and an entity mapped to it, as the 0.5 router would use
    g.__laratype_route_model_bindings = { user: async (value: string) => (lookups.push(value), null) }
    g.__laratype_param_model_map = { user: 'User' }
    try {
      const { app } = mount(routes)
      const res = await app.request('/api/users/7/posts')
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ user: '7', posts: [] })
      expect(lookups).toEqual([])
      // the handler's second argument is the raw params object
      const member = defineContract()({ show: endpoint.get('/').response(anything) })
      class Member extends Controller { show(_req: unknown, params: { user: string }) { return { user: params.user } } }
      const memberApp = mount(Route.api(defineApi({ member: { contract: member, path: '/members/:user', scopes: [], dirs: [] } }), (r) => [r.contract(member, Member)])).app
      expect(await (await memberApp.request('/members/7')).json()).toEqual({ user: '7' })
      expect(lookups).toEqual([])
    } finally {
      g.__laratype_route_model_bindings = saved.bindings
      g.__laratype_param_model_map = saved.map
    }
  })

  it('returns one registry entry per route: name, method, path, endpoint, controller, middleware, policies', () => {
    const { entries } = mount(routes)
    expect(entries.map((e) => [e.name, e.method, e.path])).toEqual([
      ['users.index', 'get', '/api/users'],
      ['users.show', 'get', '/api/users/:id'],
      ['users.posts.index', 'get', '/api/users/:user/posts'],
      ['users.posts.store', 'post', '/api/users/:user/posts'],
    ])
    // routes.routes holds the contract routes only, typed as RouteEntry
    const store = routes.routes[3]!
    expect(store.endpoint).toBe(posts.store)
    expect(store.contract).toBe(posts)
    expect(store.controller).toEqual([PostController, 'store'])
    expect(store.middleware).toEqual([Audit, Trace])
    expect(store.policies).toEqual([{ dir: 'users/[user]', policy: UserScopePolicy }])
    expect(store.scopes).toEqual([root, usersUser])
    expect(store.authorize).toBe(true)
    expect(store.domain).toBeUndefined()
    expect(store.unenforced).toEqual(['auth', 'authorize'])
    expect(routes.routes[0]!.unenforced).toEqual(['auth'])
    expect(routes.routes[0]!.policies).toEqual([])
    expect(routes.routes[0]!.middleware).toEqual([])
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

  it('.domain() reads the Host header (port and one trailing dot stripped), never X-Forwarded-Host', async () => {
    const app = new Hono()
    routes.domain('api.example.test').mount(app)
    app.get('/api/users', (c) => c.text('fallback'))
    const get = (host: string, extra: Record<string, string> = {}) => app.request('http://internal.test/api/users', { headers: { host, ...extra } })
    expect(await (await get('API.example.test:3000')).json()).toEqual({ users: ['ada'] })
    expect(await (await get('api.example.test.')).json()).toEqual({ users: ['ada'] })
    expect(await (await get('other.test', { 'x-forwarded-host': 'api.example.test' })).text()).toBe('fallback')
    const v6 = new Hono()
    routes.domain('localhost').mount(v6)
    expect((await v6.request('http://x/api/users', { headers: { host: '[::1]:3000' } })).status).toBe(404)
  })

  it('.domain() strips one trailing dot from the request hostname', async () => {
    const app = new Hono()
    routes.domain('api.example.test').mount(app)
    expect(await (await app.request('http://api.example.test.:3000/api/users')).json()).toEqual({ users: ['ada'] })
  })

  it('.domain() re-labels the checked routes without planning them again', () => {
    class Late extends Controller { index() { return [] } show() { return {} } }
    const late = Route.api(appApi, (r) => [
      r.contract(users, Late),
      r.scope('users/[user]', { policy: UserScopePolicy }),
      r.contract(posts, PostController),
    ])
    // A plan() rerun would now fail on the missing handler
    delete (Late.prototype as Partial<Late>).show
    const onHost = late.domain('api.example.test')
    expect(onHost.routes[0]!.domain).toBe('api.example.test')
    expect(onHost.routes.map((r) => r.domain)).toEqual(['api.example.test', 'api.example.test', 'api.example.test', 'api.example.test'])
    expect(onHost.routes[1]!.controller).toBe(late.routes[1]!.controller)
    expect(late.routes.every((r) => r.domain === undefined)).toBe(true)
  })

  it('rejects a domain that is not a hostname', () => {
    expect(() => routes.domain('https://api.example.test')).toThrow(/\.domain\("https:\/\/api.example.test"\) must be a hostname/)
    for (const bad of ['api.example.test:3000', '', 'api..example.test', '.api.example.test', 'api.example.test.', '-api.example.test', 'api-.example.test', 'api.ex_ample.test']) {
      expect(() => routes.domain(bad)).toThrow(/must be a hostname/)
    }
    expect(routes.domain('my-api.example-1.test').routes[0]!.domain).toBe('my-api.example-1.test')
  })
})

describe('auth and authorize are not enforced yet', () => {
  // the warning is remembered per process
  beforeEach(() => { delete (globalThis as Record<symbol, unknown>)[Symbol.for('laratype.http.unenforcedWarned')] })

  it('warns once per process for the same routes (dev restarts re-mount them), again when they change', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const build = () => Route.api(appApi, (r) => [
      r.contract(users, UserController),
      r.scope('users/[user]', { policy: UserScopePolicy }),
      r.contract(posts, PostController),
    ])
    mount(build())
    mount(build())
    expect(warn).toHaveBeenCalledTimes(1)
    mount(build().domain('api.example.test'))
    expect(warn).toHaveBeenCalledTimes(1)
    const open = defineContract()({ ping: endpoint.get('/').throttle({ limit: 1, per: 1 }) })
    class Ping extends Controller { ping() {} }
    mount(Route.api(defineApi({ ping: { contract: open, path: '/ping', scopes: [], dirs: [] } }), (r) => [r.contract(open, Ping)]))
    expect(warn).toHaveBeenCalledTimes(2)
    // the first list is still remembered
    mount(build())
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('two Route.api groups warn once each, across restarts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const open = defineContract()({ ping: endpoint.get('/').throttle({ limit: 1, per: 1 }) })
    class Ping extends Controller { ping() {} }
    const groups = () => [
      Route.api(appApi, (r) => [r.contract(users, UserController), r.scope('users/[user]', { policy: UserScopePolicy }), r.contract(posts, PostController)]),
      Route.api(defineApi({ ping: { contract: open, path: '/ping', scopes: [], dirs: [] } }), (r) => [r.contract(open, Ping)]).domain('api.example.test'),
    ]
    for (const restart of [1, 2, 3]) for (const group of groups()) mount(group)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('the remembered lists are capped, dropping the oldest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    class Ping extends Controller { ping() {} }
    const group = (i: number) => {
      const c = defineContract()({ ping: endpoint.get('/').throttle({ limit: 1, per: 1 }) })
      return Route.api(defineApi({ [`p${i}`]: { contract: c, path: `/p${i}`, scopes: [], dirs: [] } }), (r) => [r.contract(c, Ping)])
    }
    for (let i = 0; i < 40; i++) mount(group(i))
    expect(warn).toHaveBeenCalledTimes(40)
    const remembered = (globalThis as Record<symbol, Set<string>>)[Symbol.for('laratype.http.unenforcedWarned')]!
    expect(remembered.size).toBe(32)
    // the oldest were dropped: p0 warns again, p39 does not
    mount(group(39))
    expect(warn).toHaveBeenCalledTimes(40)
    mount(group(0))
    expect(warn).toHaveBeenCalledTimes(41)
  })

  it('mount() warns once, listing the routes with auth or authorize', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount(Route.api(appApi, (r) => [
      r.contract(users, UserController),
      r.scope('users/[user]', { policy: UserScopePolicy }),
      r.contract(posts, PostController),
    ]))
    expect(UNENFORCED_NOTICE).toBe('auth, authorize, throttle and input schema validation are not enforced yet (planned → #105, #121, #229, #106)')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      '[@laratype/http] Route.api: auth, authorize, throttle and input schema validation are not enforced yet (planned → #105, #121, #229, #106), so these routes skip those checks: ' +
        'users.index (auth), users.show (auth), users.posts.index (auth, authorize), users.posts.store (auth, authorize)',
    )
  })

  it('lists routes whose body, query or headers schema is not validated yet (#106)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const schema = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const
    const forms = defineContract()({
      list: endpoint.get('/').query(schema),
      send: endpoint.post('/').body(schema),
      head: endpoint.get('/h').headers(schema),
      ping: endpoint.get('/ping'),
      slow: endpoint.get('/slow').throttle({ limit: 1, per: 60 }),
    })
    class Forms extends Controller { list() {} send() {} head() {} ping() {} slow() {} }
    const formRoutes = Route.api(defineApi({ forms: { contract: forms, path: '/forms', scopes: [], dirs: [] } }), (r) => [r.contract(forms, Forms)])
    mount(formRoutes)
    expect(formRoutes.routes.map((e) => [e.name, e.unenforced])).toEqual([
      ['forms.list', ['validation']], ['forms.send', ['validation']], ['forms.head', ['validation']], ['forms.ping', []], ['forms.slow', ['throttle']],
    ])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(': forms.list (validation), forms.send (validation), forms.head (validation), forms.slow (throttle)'))
  })

  it('no warning without auth or authorize', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const open = defineContract()({ ping: endpoint.get('/') })
    class Ping extends Controller { ping() {} }
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

  it('constructor, Object.prototype and base Controller methods are not handlers', () => {
    const odd = defineContract()({ constructor: endpoint.get('/c'), exposed: endpoint.get('/e'), toString: endpoint.get('/t') })
    const oddApi = defineApi({ odd: { contract: odd, path: '/odd', scopes: [], dirs: [] } })
    class Plain extends Controller {}
    for (const key of ['constructor', 'exposed', 'toString']) {
      const only = defineContract()({ [key]: endpoint.get('/x') } as Record<string, ReturnType<typeof endpoint.get>>)
      const onlyApi = defineApi({ only: { contract: only, path: '/only', scopes: [], dirs: [] } } as never)
      expect(() => Route.api(onlyApi as any, ((r: any) => [r.contract(only, Plain)]) as never)).toThrow(`only.${key}: Plain has no method "${key}"`)
    }
    // methods of the controller and of classes between it and Controller do count; an own exposed() override too
    class Base extends Controller { toString() { return 'base' } }
    class Own extends Base { exposed() { return ['x'] } }
    expect(() => Route.api(oddApi as any, ((r: any) => [r.contract(odd, Own)]) as never)).toThrow('odd.constructor: Own has no method "constructor"')
    const fine = defineContract()({ exposed: endpoint.get('/e'), toString: endpoint.get('/t') })
    // the runtime's handler rules for these odd keys, outside the route proof (which reads only the controller's own type)
    expect(() => Route.api(defineApi({ fine: { contract: fine, path: '/fine', scopes: [], dirs: [] } }), (r) => [r.contract(fine, Own as never)])).not.toThrow()
  })

  it('a middleware mounted twice runs once, at its first position', () => {
    const tree = defineScope()({ throws: [] })
    const inner = defineScope<ContractPrefix<'/a/:x', [typeof tree]>>()({ throws: [] })
    const deep = defineContract()({ index: endpoint.get('/') })
    const nested = defineApi({ 'a.b': { contract: deep, path: '/a/:x/b', scopes: [tree, inner], dirs: ['', 'a/[x]'] } })
    class Deep extends Controller { index() {} }
    class Web extends Middleware {}
    const { entries } = mount(Route.api(nested, (r) => {
      const web = r.middleware(Web)
      return [
        web.scope('', { policy: UserScopePolicy }),
        web.middleware(Audit).scope('a/[x]', { policy: UserScopePolicy }),
        web.middleware(Trace, Audit).contract(deep, Deep),
      ]
    }))
    expect(entries[0]!.middleware).toEqual([Web, Audit, Trace])
  })

  it('a 0.5 status decorator that disagrees with the endpoint status fails, naming both', () => {
    const shop = defineContract()({ store: endpoint.post('/').response(anything, 201), show: endpoint.get('/') })
    const shopApi = defineApi({ shop: { contract: shop, path: '/shop', scopes: [], dirs: [] } })
    class Shop extends Controller { store() { return {} } show() {} }
    Reflect.defineMetadata('laratype:controller_status_code', 202, Shop.prototype, 'store')
    expect(() => Route.api(shopApi, (r) => [r.contract(shop, Shop)])).toThrow(
      '[@laratype/http] Route.api: shop.store: Shop.store has status 202 from its status decorator, but the endpoint declares 201: declare .response(schema, 202) on the endpoint, or drop the decorator',
    )
    // equal values are fine
    Reflect.defineMetadata('laratype:controller_status_code', 201, Shop.prototype, 'store')
    expect(() => Route.api(shopApi, (r) => [r.contract(shop, Shop)])).not.toThrow()
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
