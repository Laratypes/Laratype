// H7 #118: typed route model binding with r.bind() (docs/v1/http.md › Model binding).
// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { defineApi, defineContract, defineScope, endpoint } from '@laratype/contract'
import type { ContractPrefix } from '@laratype/contract'
import { Controller, RequestKernel, ResponseKernel, Route, defineMiddleware } from '../../src/index'
import type { Ctx } from '../../src/index'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const

// app/api/users/[user]/_scope.ts (no capability: the folder gives the param) and app/api/users/[user]/posts.ts
const root = defineScope()({})
const usersUser = defineScope<ContractPrefix<'/api/users/:user', [typeof root]>>()({})
const posts = defineContract()({
  index: endpoint.get('/').response(anything),
  show: endpoint.get('/:post').response(anything),
  latest: endpoint.get('/latest/:post?').response(anything),
})
const appApi = defineApi({
  'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [{ scope: root, dir: '' }, { scope: usersUser, dir: 'users/[user]' }] },
})

const lookups: string[] = []

class User {
  static readonly primaryKey = 'id'
  static async findByRouteKey(key: string): Promise<User | null> {
    lookups.push(`user:${key}`)
    return key === 'missing' ? null : new User(key)
  }
  constructor(readonly id: string) {}
}

class Post {
  static readonly primaryKey = 'id'
  static readonly routeKeyName = 'slug'
  static async findByRouteKey(key: string): Promise<Post | undefined> {
    lookups.push(`post:${key}`)
    return key === 'missing' ? undefined : new Post(key)
  }
  constructor(readonly slug: string) {}
}

class ScopedUser extends User {
  static override async findByRouteKey(key: string): Promise<User | null> {
    lookups.push(`scoped:${key}`)
    return new ScopedUser(`scope:${key}`)
  }
}

class ContractUser extends ScopedUser {
  static override async findByRouteKey(key: string): Promise<User | null> {
    lookups.push(`contract:${key}`)
    return new ContractUser(`contract:${key}`)
  }
}

class BoundController extends Controller {
  index(ctx: Ctx<typeof posts.index, { params: { user: User } }>) { return { user: ctx.params.user.id } }
  show(ctx: Ctx<typeof posts.show, { params: { user: User; post: Post } }>) { return { user: ctx.params.user.id, post: ctx.params.post.slug } }
  latest(ctx: Ctx<typeof posts.latest, { params: { user: User; post: Post | undefined } }>) {
    return { user: ctx.params.user.id, post: ctx.params.post?.slug ?? null }
  }
}

/** The second handler argument: the raw path params, never the bound models. */
class RawController extends Controller {
  index() { return {} }
  show(ctx: Ctx<typeof posts.show, { params: { user: User; post: Post } }>, raw: { user: string; post: string }) {
    return { user: ctx.params.user.id, post: ctx.params.post.slug, raw }
  }
  latest() { return {} }
}

/** The scope tests mount the contract from the root builder: only the folder param is bound at runtime. */
class ScopeController extends Controller {
  index() { return {} }
  show(ctx: { params: { user: User; post: string } }) { return { user: ctx.params.user.id, post: ctx.params.post } }
  latest() { return {} }
}

/** A post model the tests never bind: the frozen copy must keep `Post`. */
class OtherPost {
  declare readonly slug: string
  static readonly primaryKey = 'id'
  static async findByRouteKey(key: string): Promise<OtherPost | null> {
    lookups.push(`other:${key}`)
    return new OtherPost()
  }
}

class PostPolicy {}

const mount = (routes: ReturnType<typeof Route.api>) => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  routes.mount(app)
  return app
}

let app: Hono

beforeEach(() => {
  vi.restoreAllMocks()
  lookups.length = 0
  app = mount(Route.api(appApi, (r) => [r.bind({ user: User, post: Post }).contract(posts, BoundController)]))
})

describe('r.bind()', () => {
  it('contributes the model to ctx.params and resolves it once per request', async () => {
    const res = await app.request('/api/users/7/posts/hello')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: '7', post: 'hello' })
    expect(lookups).toEqual(['user:7', 'post:hello'])
  })

  it('binds a parent [x] folder param and the endpoint param together', async () => {
    // `user` is a param of the folder tree, `post` of the endpoint: one binding, both resolved
    expect(await (await app.request('/api/users/ada/posts/first')).json()).toEqual({ user: 'ada', post: 'first' })
  })

  it('keeps the second handler argument raw', async () => {
    const rawApp = mount(Route.api(appApi, (r) => [r.bind({ user: User, post: Post }).contract(posts, RawController)]))
    expect(await (await rawApp.request('/api/users/007/posts/raw')).json()).toEqual({
      user: '007',
      post: 'raw',
      raw: { user: '007', post: 'raw' },
    })
  })

  it('a class miss is a 404 with the contract NOT_FOUND body, and no lookup runs for other endpoints', async () => {
    const res = await app.request('/api/users/missing/posts/hello')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ code: 'NOT_FOUND', message: 'Not Found.' })
    expect(lookups).toEqual(['user:missing'])
  })

  it('a resolver gets the raw string, and its null / undefined is a 404', async () => {
    const seen: string[] = []
    const resolver = (raw: string) => {
      seen.push(raw)
      return raw === 'missing' ? null : new User(raw)
    }
    const resolved = mount(Route.api(appApi, (r) => [r.bind({ user: resolver, post: Post }).contract(posts, BoundController)]))
    expect(await (await resolved.request('/api/users/007/posts/x')).json()).toEqual({ user: '007', post: 'x' })
    expect(seen).toEqual(['007'])
    const missing = await resolved.request('/api/users/missing/posts/x')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ code: 'NOT_FOUND', message: 'Not Found.' })
  })

  it('an optional param absent is undefined, present with a miss is a 404', async () => {
    expect(await (await app.request('/api/users/7/posts/latest')).json()).toEqual({ user: '7', post: null })
    expect(await (await app.request('/api/users/7/posts/latest/hello')).json()).toEqual({ user: '7', post: 'hello' })
    expect(lookups).toEqual(['user:7', 'user:7', 'post:hello'])
    const missing = await app.request('/api/users/7/posts/latest/missing')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ code: 'NOT_FOUND', message: 'Not Found.' })
  })

  it('a binding wins over a typed middleware extension that adds the same params key', async () => {
    // The route proof promises the bound type, so the extension's raw string does not replace the model (H7 #118)
    const stale = defineMiddleware<{ params: { post: string } }>((_request, next) => next({ params: { post: 'stale' } }))
    const winning = mount(Route.api(appApi, (r) => [r.middleware(stale).bind({ user: User, post: Post }).contract(posts, BoundController)]))
    expect(await (await winning.request('/api/users/7/posts/hello')).json()).toEqual({ user: '7', post: 'hello' })
  })

  it('is a frozen copy: mutating the object after Route.api changes no route', async () => {
    const bindings = { user: User, post: Post }
    const frozen = mount(Route.api(appApi, (r) => [r.bind(bindings).contract(posts, BoundController)]))
    bindings.post = OtherPost
    expect(await (await frozen.request('/api/users/7/posts/hello')).json()).toEqual({ user: '7', post: 'hello' })
    expect(lookups).toEqual(['user:7', 'post:hello'])
  })

  it('binds through a regex param pattern', async () => {
    const patterned = defineContract()({ show: endpoint.get('/:post{[a-z]+}').response(anything) })
    const patternedApi = defineApi({ patterns: { contract: patterned, path: '/patterns', scopes: [] } })
    class PatternController extends Controller {
      show(ctx: Ctx<typeof patterned.show, { params: { post: Post } }>) { return { post: ctx.params.post.slug } }
    }
    const patterns = mount(Route.api(patternedApi, (r) => [r.bind({ post: Post }).contract(patterned, PatternController)]))
    expect(await (await patterns.request('/patterns/hello')).json()).toEqual({ post: 'hello' })
    // The pattern itself still rejects a value with no match, before any binding
    expect((await patterns.request('/patterns/123')).status).toBe(404)
    expect(lookups).toEqual(['post:hello'])
  })

  it('an absent optional param does not read a member of Object.prototype', async () => {
    // `:constructor?` is absent: `params['constructor']` would be Object's constructor without the own-key check
    const named = defineContract()({ maybe: endpoint.get('/:constructor?').response(anything) })
    const namedApi = defineApi({ named: { contract: named, path: '/named', scopes: [] } })
    class NamedController extends Controller {
      maybe(ctx: { params: { constructor?: User } }) { return { bound: ctx.params.constructor === undefined } }
    }
    const routes = mount(Route.api(namedApi, (r) => [r.bind({ constructor: User }).contract(named, NamedController)]))
    expect(await (await routes.request('/named')).json()).toEqual({ bound: true })
    expect(lookups).toEqual([])
  })

  it('a 404 from the binding precedes the 422 of an invalid body', async () => {
    const forms = defineContract()({ store: endpoint.post('/:post').body(z.object({ name: z.string() })).response(anything) })
    const formsApi = defineApi({ forms: { contract: forms, path: '/forms', scopes: [] } })
    class FormsController extends Controller {
      store(ctx: Ctx<typeof forms.store, { params: { post: Post } }>) { return { post: ctx.params.post.slug } }
    }
    const strict = mount(Route.api(formsApi, (r) => [r.bind({ post: Post }).contract(forms, FormsController)]))
    const res = await strict.request('/forms/missing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ code: 'NOT_FOUND', message: 'Not Found.' })
    expect(lookups).toEqual(['post:missing'])
  })

  it('an ad-hoc route of a bound builder takes no binding', async () => {
    class NoBindings extends Controller {
      index() { return {} }
      show() { return {} }
      latest() { return {} }
    }
    const routes = mount(Route.api(appApi, (r) => [
      r.contract(posts, NoBindings),
      r.bind({ user: User, post: Post }).get('/adhoc/:user', (_request, params) => params.user),
    ]))
    const res = await routes.request('/adhoc/7')
    expect(await res.text()).toBe('7')
    expect(lookups).toEqual([])
  })
})

describe('scope bindings', () => {
  it('bind every contract under the folder at runtime', async () => {
    const scoped = mount(Route.api(appApi, (r) => [
      r.bind({ user: User }).scope('users/[user]', { policy: PostPolicy }),
      r.contract(posts, ScopeController),
    ]))
    expect(await (await scoped.request('/api/users/7/posts/hello')).json()).toEqual({ user: '7', post: 'hello' })
    expect(lookups).toEqual(['user:7'])
  })

  it('a contract binding wins over the scope binding of the same key', async () => {
    const scoped = Route.api(appApi, (r) => {
      const bound = r.bind({ user: ScopedUser })
      return [
        bound.scope('users/[user]', { policy: PostPolicy }),
        bound.bind({ user: ContractUser }).contract(posts, ScopeController),
      ]
    })
    const res = await mount(scoped).request('/api/users/7/posts/hello')
    // Only the contract-level binder ran, and only once
    expect(await res.json()).toEqual({ user: 'contract:7', post: 'hello' })
    expect(lookups).toEqual(['contract:7'])
  })
})

describe('r.bind() validation at Route.api', () => {
  const mountWith = (bindings: Record<string, unknown>) =>
    Route.api(appApi, (r) => {
      r.bind(bindings as never)
      return [r.contract(posts, BoundController)]
    })

  it('needs a function', () => {
    expect(() => mountWith({ user: 42 })).toThrow(
      '[@laratype/http] Route.api: r.bind(): `user` must be a model class (static primaryKey, optional routeKeyName, findByRouteKey(key)) or a (raw: string) => value resolver',
    )
  })

  it('a class needs a static findByRouteKey', () => {
    class Plain { static readonly primaryKey = 'id' }
    expect(() => mountWith({ user: Plain })).toThrow(
      '[@laratype/http] Route.api: r.bind(): `user` is a model class without a static findByRouteKey (BindableModel: primaryKey, optional routeKeyName, findByRouteKey(key))',
    )
  })

  it('a model class needs a static primaryKey', () => {
    class NoKey {
      static async findByRouteKey(key: string) { return key }
    }
    expect(() => mountWith({ user: NoKey })).toThrow(
      '[@laratype/http] Route.api: r.bind(): `user` is a model class without a static primaryKey (the default route key of BindableModel)',
    )
  })
})

describe('the 0.5 model binding paths', () => {
  it('leave Route.api routes on the raw params', async () => {
    // Route.api keeps RouteParams.modelBinding false: no implicit lookup and no undeclared 404 before the handler
    class NoBindings extends Controller {
      index() { return {} }
      show(ctx: { params: { user: string; post: string } }) { return ctx.params }
      latest() { return {} }
    }
    const raw = mount(Route.api(appApi, (r) => [r.contract(posts, NoBindings)]))
    expect(await (await raw.request('/api/users/7/posts/hello')).json()).toEqual({ user: '7', post: 'hello' })
    expect(lookups).toEqual([])
  })
})
