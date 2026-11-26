// H14 #163: typed implicit model binding (docs/v1/http.md › Model binding). The runtime keys come from the app
// manifest at Route.api(), the classes from ModelBindingRegistry.routeModels per request.
import 'reflect-metadata'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { Container, Facade, depsRegistry } from '@laratype/core'
import { HTTP_APP, ModelBindingRegistry, peekAppManifest, setAppManifest } from '@laratype/support'
import type { AppManifest } from '@laratype/support'
import { defineApi, defineContract, defineScope, endpoint } from '@laratype/contract'
import type { ContractPrefix } from '@laratype/contract'
import { Controller, RequestKernel, ResponseKernel, Route } from '../../src/index'
import { resolveRouteBindings } from '../../src/routing/api/bindings'
import { resetRouteRegistry } from '../../src/routing/routeUrl'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const

const modelEntry = (name: string) => ({ name, path: `app/models/${name}.ts`, load: async () => ({}) })

/** The app manifest the typegen and the database provider also read; only the `models` kind matters here. */
const manifest = (...names: string[]): AppManifest => ({
  configs: [],
  routes: [],
  commands: [],
  models: names.map(modelEntry),
  migrations: [],
  seeders: [],
  factories: [],
  modules: [],
  lang: [],
})

const previousManifest = peekAppManifest()
const lookups: string[] = []

class User {
  static readonly primaryKey = 'id'
  // The second parameter is declared even when unused: a scoped route checks `findByRouteKey.length` (H14 #163)
  static async findByRouteKey(key: string, _scope?: Readonly<Record<string, object>>): Promise<User | null> {
    lookups.push(`user:${key}`)
    return key === 'missing' ? null : new User(key)
  }
  constructor(readonly id: string) {}
}

/** A child model that only resolves through the scope record (`r.scopeBindings()`, H14 #163). */
class ScopedPost {
  static readonly primaryKey = 'slug'
  static readonly routeKeyName = 'slug'
  static async findByRouteKey(key: string, scope?: Readonly<Record<string, object>>): Promise<ScopedPost | null> {
    lookups.push(`post:${key}`)
    if (scope === undefined || !Object.isFrozen(scope)) return null
    const user = scope.user as User | undefined
    return user?.id === '7' && key !== 'missing' ? new ScopedPost(key) : null
  }
  constructor(readonly slug: string) {}
}

/** A third-level child that relates only to its immediate parent (the post), as a normal comment does. */
class ScopedComment {
  static readonly primaryKey = 'id'
  static async findByRouteKey(key: string, scope?: Readonly<Record<string, object>>): Promise<ScopedComment | null> {
    lookups.push(`comment:${key}`)
    const post = scope?.post as ScopedPost | undefined
    // Only a comment of the post the route resolved: the user is transitive here
    return post?.slug === 'hello' ? new ScopedComment(key) : null
  }
  constructor(readonly id: string) {}
}

class ToStringModel {
  static readonly primaryKey = 'id'
  static async findByRouteKey(key: string): Promise<ToStringModel | null> {
    lookups.push(`toString:${key}`)
    return new ToStringModel(key)
  }
  constructor(readonly id: string) {}
}

class ConstructorModel {
  static readonly primaryKey = 'id'
  static async findByRouteKey(key: string): Promise<ConstructorModel | null> {
    lookups.push(`constructor:${key}`)
    return new ConstructorModel(key)
  }
  constructor(readonly id: string) {}
}

/** A folder policy: the scope checks run before the policy class is used. */
class FolderPolicy {}

/** The controller reads `params.user` without a type assertion: a string stays a string, a model arrives as one. */
class ShowController extends Controller {
  show(ctx: { params: Record<string, unknown> }) {
    const user = ctx.params.user as User | string
    return { user: typeof user === 'string' ? `string:${user}` : `model:${user.id}` }
  }
}

class NestedController extends Controller {
  index() { return {} }
  show(ctx: { params: Record<string, unknown> }) {
    return { user: (ctx.params.user as User).id, post: (ctx.params.post as ScopedPost).slug }
  }
}

class CommentsController extends Controller {
  show(ctx: { params: Record<string, unknown> }) {
    return {
      user: (ctx.params.user as User).id,
      post: (ctx.params.post as ScopedPost).slug,
      comment: (ctx.params.comment as ScopedComment).id,
    }
  }
}

class KeyedController extends Controller {
  show(ctx: { params: Record<string, unknown> }) {
    const value = ctx.params.toString as ToStringModel | string
    return { value: typeof value === 'string' ? `string:${value}` : `model:${value.id}` }
  }
}

class CtorController extends Controller {
  show(ctx: { params: Record<string, unknown> }) {
    const value = ctx.params.constructor as ConstructorModel | string
    return { value: typeof value === 'string' ? `string:${value}` : `model:${value.id}` }
  }
}

const mount = (routes: ReturnType<typeof Route.api>, models: Record<string, unknown> = {}) => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  container.make(ModelBindingRegistry).routeModels = models
  routes.mount(app)
  return { app, container }
}

const usersContract = defineContract()({ show: endpoint.get('/:user').response(anything) })
const usersApi = defineApi({ users: { contract: usersContract, path: '/api/users', scopes: [] } })

const rootScope = defineScope()({})
const userScope = defineScope<ContractPrefix<'/api/users/:user', [typeof rootScope]>>()({})
const nestedContract = defineContract()({
  index: endpoint.get('/').response(anything),
  show: endpoint.get('/:post').response(anything),
})
const nestedApi = defineApi({
  'users.posts': {
    contract: nestedContract,
    path: '/api/users/:user/posts',
    scopes: [{ scope: rootScope, dir: '' }, { scope: userScope, dir: 'users/[user]' }],
  },
})

// Three levels: /api/users/:user/posts/:post/comments/:comment is scoped by `{ user, post }`
const postScope = defineScope<ContractPrefix<'/api/users/:user/posts/:post', [typeof rootScope, typeof userScope]>>()({})
const commentsContract = defineContract()({ show: endpoint.get('/:comment').response(anything) })
const commentsApi = defineApi({
  'users.posts.comments': {
    contract: commentsContract,
    path: '/api/users/:user/posts/:post/comments',
    scopes: [
      { scope: rootScope, dir: '' },
      { scope: userScope, dir: 'users/[user]' },
      { scope: postScope, dir: 'users/[user]/posts/[post]' },
    ],
  },
})

const numericContract = defineContract()({ show: endpoint.get('/:1').response(anything) })
const numericApi = defineApi({ numeric: { contract: numericContract, path: '/api/numeric', scopes: [] } })

const mountComments = (
  build: Build,
  models: Record<string, unknown> = { user: User, post: ScopedPost, comment: ScopedComment },
) => mount(Route.api(commentsApi, build), models)

type Build = (r: any) => any[]

const mountUsers = (build: Build, models: Record<string, unknown> = { user: User }) =>
  mount(Route.api(usersApi, build), models)

const mountNested = (build: Build, models: Record<string, unknown> = { user: User, post: ScopedPost }) =>
  mount(Route.api(nestedApi, build), models)

beforeEach(() => {
  resetRouteRegistry()
  lookups.length = 0
  setAppManifest(manifest('User', 'Post'))
})

afterEach(() => {
  Facade.setFacadeApplication(undefined)
})

afterAll(() => {
  if (previousManifest) setAppManifest(previousManifest)
})

describe('implicit binding (H14 #163)', () => {
  it('binds a path param whose name is a registered model, once per request', async () => {
    const { app } = mountUsers((r) => [r.contract(usersContract, ShowController)])
    const res = await app.request('/api/users/7')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: 'model:7' })
    expect(lookups).toEqual(['user:7'])
  })

  it('binds through the model routeKeyName (a custom lookup column)', async () => {
    class SlugUser {
      static readonly primaryKey = 'id'
      static readonly routeKeyName = 'slug'
      static async findByRouteKey(key: string, _scope?: Readonly<Record<string, object>>): Promise<SlugUser | null> {
        lookups.push(`slug:${key}`)
        return key === 'missing' ? null : new SlugUser(key, key)
      }
      constructor(readonly slug: string, readonly id: string) {}
    }
    const { app } = mountUsers((r) => [r.contract(usersContract, ShowController)], { user: SlugUser })
    expect(await (await app.request('/api/users/ada-lovelace')).json()).toEqual({ user: 'model:ada-lovelace' })
    expect(lookups).toEqual(['slug:ada-lovelace'])
    expect((await app.request('/api/users/missing')).status).toBe(404)
  })

  it('a miss is the contract 404 and stops the lookups after it', async () => {
    const { app } = mountUsers((r) => [r.contract(usersContract, ShowController)])
    const res = await app.request('/api/users/missing')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ code: 'NOT_FOUND', message: 'Not Found.' })
    expect(lookups).toEqual(['user:missing'])
  })

  it('lets an explicit .bind() win the key it binds, with one lookup', async () => {
    const explicit: string[] = []
    const { app } = mountUsers((r) => [
      r.bind({ user: (raw: string) => { explicit.push(raw); return new User(`bound:${raw}`) } }).contract(usersContract, ShowController),
    ])
    expect(await (await app.request('/api/users/7')).json()).toEqual({ user: 'model:bound:7' })
    expect(explicit).toEqual(['7'])
    expect(lookups).toEqual([])
  })

  it('.withoutImplicitBinding() keeps the string, and the route does not 404 on a miss', async () => {
    const { app } = mountUsers((r) => [r.withoutImplicitBinding().contract(usersContract, ShowController)])
    expect(await (await app.request('/api/users/7')).json()).toEqual({ user: 'string:7' })
    expect((await app.request('/api/users/missing')).status).toBe(200)
    expect(lookups).toEqual([])
  })

  it('binds an Object.prototype member name as an ordinary key', async () => {
    setAppManifest(manifest('toString'))
    const toStringContract = defineContract()({ show: endpoint.get('/:toString').response(anything) })
    const toStringApi = defineApi({ things: { contract: toStringContract, path: '/api/things', scopes: [] } })
    const { app } = mount(Route.api(toStringApi, (r) => [r.contract(toStringContract, KeyedController)]), { toString: ToStringModel })
    expect(await (await app.request('/api/things/7')).json()).toEqual({ value: 'model:7' })
    expect(lookups).toEqual(['toString:7'])
  })

  it('binds a constructor key too, from an own map entry', async () => {
    setAppManifest(manifest('constructor'))
    const ctorContract = defineContract()({ show: endpoint.get('/:constructor').response(anything) })
    const ctorApi = defineApi({ ctors: { contract: ctorContract, path: '/api/ctors', scopes: [] } })
    const { app } = mount(Route.api(ctorApi, (r) => [r.contract(ctorContract, CtorController)]), { constructor: ConstructorModel })
    expect(await (await app.request('/api/ctors/7')).json()).toEqual({ value: 'model:7' })
  })

  it('a registered model with no loaded class is a 500, never the raw string', async () => {
    const { app } = mountUsers((r) => [r.contract(usersContract, ShowController)], {})
    expect((await app.request('/api/users/7')).status).toBe(500)
  })

  it('does not bind without a manifest (a bare Hono app or a test)', async () => {
    setAppManifest(undefined as unknown as AppManifest)
    const { app } = mountUsers((r) => [r.contract(usersContract, ShowController)])
    expect(await (await app.request('/api/users/7')).json()).toEqual({ user: 'string:7' })
    expect(lookups).toEqual([])
  })

  it('does not bind when the manifest has a scan error', async () => {
    setAppManifest({ ...manifest('User'), error: '[laratype:manifest] models/User is in both layouts' })
    const { app } = mountUsers((r) => [r.contract(usersContract, ShowController)])
    expect(await (await app.request('/api/users/7')).json()).toEqual({ user: 'string:7' })
    expect(lookups).toEqual([])
  })

  it('reads a hand-edited manifest defensively: a non-array list or an entry with no name binds nothing', async () => {
    setAppManifest({ ...manifest(), models: 'User' } as unknown as AppManifest)
    const notAList = mountUsers((r) => [r.contract(usersContract, ShowController)])
    expect(await (await notAList.app.request('/api/users/7')).json()).toEqual({ user: 'string:7' })
    setAppManifest({ ...manifest(), models: [{ path: 'app/models/User.ts' }] } as unknown as AppManifest)
    const unnamed = mountUsers((r) => [r.contract(usersContract, ShowController)])
    expect(await (await unnamed.app.request('/api/users/7')).json()).toEqual({ user: 'string:7' })
    expect(lookups).toEqual([])
  })

  it('a doubled .withoutImplicitBinding() and .scopeBindings() keep their flag, and .bind() still binds on an opted-out builder', async () => {
    const optedOut = mountUsers((r) => [r.withoutImplicitBinding().withoutImplicitBinding().contract(usersContract, ShowController)])
    expect(await (await optedOut.app.request('/api/users/7')).json()).toEqual({ user: 'string:7' })
    const bound = mountUsers((r) => [
      r.withoutImplicitBinding().scopeBindings().bind({ user: User }).contract(usersContract, ShowController),
    ])
    expect(await (await bound.app.request('/api/users/7')).json()).toEqual({ user: 'model:7' })
    const scopedTwice = mountNested((r) => [r.scopeBindings().scopeBindings().contract(nestedContract, NestedController)])
    expect(await (await scopedTwice.app.request('/api/users/7/posts/hello')).json()).toEqual({ user: '7', post: 'hello' })
  })

  it('a hand-built contract item: only `implicitBinding: false` opts out; another value keeps the default', async () => {
    // The untyped caller builds the items itself, as H7's tests do for hand-built maps
    const items = (list: unknown[]) => list as never
    const item = (implicitBinding: unknown) => ({
      kind: 'contract',
      contract: usersContract,
      controller: ShowController,
      middleware: [],
      implicitBinding,
    })
    const off = mount(Route.api(usersApi, () => items([item(false)])), { user: User })
    expect(await (await off.app.request('/api/users/7')).json()).toEqual({ user: 'string:7' })
    const wrong = mount(Route.api(usersApi, () => items([item('no')])), { user: User })
    expect(await (await wrong.app.request('/api/users/7')).json()).toEqual({ user: 'model:7' })
  })

  it('binds nothing on an ad-hoc route', async () => {
    const { app } = mount(
      Route.api(usersApi, (r) => [r.contract(usersContract, ShowController), r.get('/echo/:user', (_req, params) => params)]),
      { user: User },
    )
    expect(await (await app.request('/echo/7')).json()).toEqual({ user: '7' })
    expect(lookups).toEqual([])
  })
})

describe('.scopeBindings() (H14 #163)', () => {
  it('passes the parent models to the child lookup, and a child of another parent is the 404', async () => {
    const { app } = mountNested((r) => [r.scopeBindings().contract(nestedContract, NestedController)])
    expect(await (await app.request('/api/users/7/posts/hello')).json()).toEqual({ user: '7', post: 'hello' })
    expect(lookups).toEqual(['user:7', 'post:hello'])
    // The child is looked up with user 8: ScopedPost answers null, so it is the same 404 and no other row leaks
    const other = await app.request('/api/users/8/posts/hello')
    expect(other.status).toBe(404)
    expect(await other.json()).toEqual({ code: 'NOT_FOUND', message: 'Not Found.' })
    expect(lookups).toEqual(['user:7', 'post:hello', 'user:8', 'post:hello'])
  })

  it('a three-level route scopes the comment by its immediate parent (the post)', async () => {
    setAppManifest(manifest('User', 'Post', 'Comment'))
    const { app } = mountComments((r) => [r.scopeBindings().contract(commentsContract, CommentsController)])
    expect(await (await app.request('/api/users/7/posts/hello/comments/c1')).json()).toEqual({
      user: '7',
      post: 'hello',
      comment: 'c1',
    })
    expect(lookups).toEqual(['user:7', 'post:hello', 'comment:c1'])
  })

  it('a comment of another post is the 404', async () => {
    setAppManifest(manifest('User', 'Post', 'Comment'))
    const { app } = mountComments((r) => [r.scopeBindings().contract(commentsContract, CommentsController)])
    const other = await app.request('/api/users/7/posts/other/comments/c1')
    expect(other.status).toBe(404)
    expect(await other.json()).toEqual({ code: 'NOT_FOUND', message: 'Not Found.' })
    expect(lookups).toEqual(['user:7', 'post:other', 'comment:c1'])
  })

  it('resolves in path order even when the bindings map declares the child first', async () => {
    const orderContract = defineContract()({
      show: endpoint.get('/:user/:post').response(anything),
    })
    const orderApi = defineApi({ order: { contract: orderContract, path: '/api/o', scopes: [] } })
    const seen: string[] = []
    class OrderUser {
      static readonly primaryKey = 'id'
      static async findByRouteKey(key: string, _scope?: Readonly<Record<string, object>>): Promise<OrderUser> { seen.push(`user:${key}`); return new OrderUser(key) }
      constructor(readonly id: string) {}
    }
    class OrderPost {
      static readonly primaryKey = 'slug'
      static async findByRouteKey(key: string, scope?: Readonly<Record<string, object>>): Promise<OrderPost | null> {
        seen.push(`post:${key}:${(scope?.user as OrderUser | undefined)?.id ?? '-'}`)
        return new OrderPost(key)
      }
      constructor(readonly slug: string) {}
    }
    class OrderController extends Controller {
      show(ctx: { params: Record<string, unknown> }) {
        return { user: (ctx.params.user as OrderUser).id, post: (ctx.params.post as OrderPost).slug }
      }
    }
    const { app } = mount(Route.api(orderApi, (r) => [
      // Declared child first: a scoped route still resolves `user` before `post` (the path order)
      r.scopeBindings().bind({ post: OrderPost, user: OrderUser }).contract(orderContract, OrderController),
    ]), {})
    expect(await (await app.request('/api/o/7/hello')).json()).toEqual({ user: '7', post: 'hello' })
    expect(seen).toEqual(['user:7', 'post:hello:7'])
  })
})

describe('implicit key mount checks (H14 #163)', () => {
  it('refuses an implicit key on a mid-path optional param', () => {
    const contract = defineContract()({ show: endpoint.get('/:user?/fixed').response(anything) })
    const api = defineApi({ mid: { contract, path: '/api/mid', scopes: [] } })
    expect(() => Route.api(api, (r) => [r.contract(contract, ShowController)])).toThrow(
      '[@laratype/http] Route.api: model binding: `user` binds `:user?` in /api/mid/:user?/fixed, where Hono registers it as `user?`',
    )
  })

  it('refuses an implicit param a static segment after an optional one drops', () => {
    setAppManifest(manifest('Post', 'First'))
    const contract = defineContract()({ show: endpoint.get('/:post/:first?/fixed/:last?').response(anything) })
    const api = defineApi({ dropped: { contract, path: '/api/dropped', scopes: [] } })
    expect(() => Route.api(api, (r) => [r.contract(contract, ShowController)])).toThrow(
      "model binding: `post` is a param of /api/dropped/:post/:first?/fixed/:last? that Hono's RegExpRouter drops from a registration's handler map",
    )
  })

  it('refuses `__proto__` as an implicit model key', () => {
    setAppManifest(manifest('__proto__'))
    const contract = defineContract()({ show: endpoint.get('/:__proto__').response(anything) })
    const api = defineApi({ proto: { contract, path: '/api/proto', scopes: [] } })
    expect(() => Route.api(api, (r) => [r.contract(contract, ShowController)])).toThrow(
      '[@laratype/http] Route.api: model binding: `__proto__` cannot be an implicit model key',
    )
  })

  it('refuses a scope binder for an implicit model key: the proof promises the model', () => {
    // Without the conflict, the scope binder would replace the implicit model at runtime while `Ctx` says User
    expect(() => Route.api(nestedApi, (r) => [
      r.bind({ user: () => 123 }).scope('users/[user]', { policy: FolderPolicy }),
      r.contract(nestedContract, NestedController),
    ])).toThrow(
      '[@laratype/http] Route.api: scope "users/[user]" binds `user`, but contract "users.posts" is mounted from a builder that does not bind it: ' +
        "bind it on the contract builder, or drop it from the scope (a handler's types see only its own builder's bindings)",
    )
  })
})

describe('.scopeBindings() mount checks (H14 #163)', () => {
  const scoped = (bind: Parameters<typeof Route.api>[1]) => expect(() => Route.api(nestedApi, bind)).toThrow(/scopeBindings/)

  it('refuses a numeric explicit binding key on a scoped route', () => {
    expect(() =>
      Route.api(numericApi, (r) => [r.scopeBindings().bind({ '1': ScopedPost }).contract(numericContract, ShowController)]),
    ).toThrow(
      '[@laratype/http] Route.api: route "numeric.show": .scopeBindings() cannot bind the numeric param "1" (a numeric key breaks the path order of the scope)',
    )
  })

  it('refuses a numeric implicit binding key on a scoped route', () => {
    setAppManifest(manifest('1'))
    expect(() => Route.api(numericApi, (r) => [r.scopeBindings().contract(numericContract, ShowController)])).toThrow(
      '[@laratype/http] Route.api: route "numeric.show": .scopeBindings() cannot bind the numeric param "1" (a numeric key breaks the path order of the scope)',
    )
  })

  it('allows a numeric key on an unscoped route', () => {
    expect(() =>
      Route.api(numericApi, (r) => [r.bind({ '1': ScopedPost }).contract(numericContract, ShowController)]),
    ).not.toThrow()
  })

  it('refuses a resolver on a scoped route', () => {
    scoped((r) => [r.scopeBindings().bind({ post: () => new ScopedPost('x') }).contract(nestedContract, NestedController)])
  })

  it('refuses a model whose findByRouteKey takes no scope parameter', () => {
    class OneArg {
      static readonly primaryKey = 'slug'
      static async findByRouteKey(key: string): Promise<OneArg | null> { return new OneArg(key) }
      constructor(readonly slug: string) {}
    }
    expect(() => Route.api(nestedApi, (r) => [r.scopeBindings().bind({ post: OneArg }).contract(nestedContract, NestedController)])).toThrow(
      '[@laratype/http] Route.api: model binding: `post` binds `OneArg`, whose findByRouteKey() takes no `scope` parameter: a .scopeBindings() route resolves a child through its parent, so declare `scope` as a plain second parameter of findByRouteKey',
    )
  })

  it('refuses a default or rest parameter: Function.length does not count them', () => {
    class Defaulted {
      static readonly primaryKey = 'slug'
      static async findByRouteKey(key: string, scope = {}): Promise<Defaulted | null> { void scope; return new Defaulted(key) }
      constructor(readonly slug: string) {}
    }
    class Rest {
      static readonly primaryKey = 'slug'
      static async findByRouteKey(...args: unknown[]): Promise<Rest | null> { return new Rest(String(args[0])) }
      constructor(readonly slug: string) {}
    }
    expect(() => Route.api(nestedApi, (r) => [r.scopeBindings().bind({ post: Defaulted }).contract(nestedContract, NestedController)])).toThrow(
      'whose findByRouteKey() takes no `scope` parameter',
    )
    expect(() => Route.api(nestedApi, (r) => [r.scopeBindings().bind({ post: Rest }).contract(nestedContract, NestedController)])).toThrow(
      'whose findByRouteKey() takes no `scope` parameter',
    )
  })
})

describe('resolveRouteBindings (H14 #163)', () => {
  const withRegistry = (models: Record<string, unknown>) => {
    const container = new Container({ deps: depsRegistry })
    Facade.setFacadeApplication(container)
    // `current()` binds the singleton: `make()` alone would answer a transient instance
    ModelBindingRegistry.current().routeModels = models
    return container
  }

  it('answers a 404 when a child is present after an absent bound parent (a layout mount refuses)', async () => {
    withRegistry({ user: User, post: ScopedPost })
    const resolved = await resolveRouteBindings(
      { explicit: {}, implicit: ['user', 'post'], scoped: true, path: '/x/:user?/:post' },
      { post: 'hello' },
    ).catch((error: unknown) => error)
    expect((resolved as { status?: number }).status).toBe(404)
  })

  it('refuses an implicit model with a one-parameter lookup on a scoped route', async () => {
    withRegistry({ user: User, post: class OneArg { static readonly primaryKey = 'slug'; static async findByRouteKey(key: string) { return key } } })
    await expect(
      resolveRouteBindings({ explicit: {}, implicit: ['user', 'post'], scoped: true, path: '/x/:user/:post' }, { user: '7', post: 'hello' }),
    ).rejects.toThrow(
      '[@laratype/http] model binding: `post` binds `OneArg`, whose findByRouteKey() takes no `scope` parameter',
    )
  })

  it('refuses a registered key with no loaded class', async () => {
    withRegistry({ user: User })
    await expect(
      resolveRouteBindings({ explicit: {}, implicit: ['post'], scoped: false, path: '/x/:post' }, { post: '7' }),
    ).rejects.toThrow(
      '[@laratype/http] implicit model binding: `post` is a model of the app manifest, but no model class is loaded for it',
    )
  })
})
