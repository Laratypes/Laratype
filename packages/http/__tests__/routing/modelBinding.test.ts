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
import { expandedPathWithoutParam, pathParamNames } from '../../src/routing/api/bindings'

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

/** The `r.bind()` value diagnostic for one key, shared by the tests that check a bad binder. */
const binderIssue = (key: string) =>
  `[@laratype/http] Route.api: r.bind(): \`${key}\` must be a model class (static primaryKey, optional routeKeyName, findByRouteKey(key)) or a (raw: string) => value resolver`

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
  show(ctx: { params: Record<string, unknown> }) {
    const { user, post } = ctx.params as { user: User; post: string }
    return { user: user.id, post }
  }
  latest() { return {} }
}

/** A post model the tests never bind: the frozen copy must keep `Post`. */
class OtherPost {
  declare readonly slug: string
  static readonly primaryKey = 'id'
  static readonly routeKeyName = 'slug'
  static async findByRouteKey(key: string): Promise<Post | undefined> {
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

  it('treats a callable constructor as a resolver (Date), as the proof does', async () => {
    class DateController extends Controller {
      index() { return {} }
      show(ctx: Ctx<typeof posts.show, { params: { user: User; post: string } }>) { return { post: typeof ctx.params.post } }
      latest() { return {} }
    }
    const routes = mount(Route.api(appApi, (r) => [r.bind({ user: User, post: Date }).contract(posts, DateController)]))
    expect(await (await routes.request('/api/users/7/posts/hello')).json()).toEqual({ post: 'string' })
  })

  it('a callable with the BindableModel statics stays a model class, as the proof types it', async () => {
    // Object.assign keeps the call signature and adds the statics: the runtime looks it up, it never calls it
    const callableModel = Object.assign((raw: string) => raw, {
      primaryKey: 'id',
      findByRouteKey: async (key: string) => (key === 'missing' ? null : new Post(key)),
    })
    class CallableController extends Controller {
      index() { return {} }
      show(ctx: Ctx<typeof posts.show, { params: { user: User; post: Post } }>) { return { post: ctx.params.post.slug } }
      latest() { return {} }
    }
    const routes = mount(Route.api(appApi, (r) => [r.bind({ user: User, post: callableModel }).contract(posts, CallableController)]))
    // the handler got a Post: the lookup ran, the callable itself did not
    expect(await (await routes.request('/api/users/7/posts/hello')).json()).toEqual({ post: 'hello' })
    expect(lookups).toEqual(['user:7'])
  })

  it('binds a param after a pattern Hono reads (a brace in a class, a nested quantifier)', async () => {
    // A `{` in a character class must not hide the params after it: the route still binds `post`
    const braced = defineContract()({ show: endpoint.get('/:prefix{[{]}/:post').response(anything) })
    const bracedApi = defineApi({ braced: { contract: braced, path: '/braced', scopes: [] } })
    class BracedController extends Controller {
      show(ctx: Ctx<typeof braced.show, { params: { prefix: string; post: Post } }>) {
        return { prefix: ctx.params.prefix, post: ctx.params.post.slug }
      }
    }
    const routes = mount(Route.api(bracedApi, (r) => [r.bind({ post: Post }).contract(braced, BracedController)]))
    expect(await (await routes.request('/braced/{/hello')).json()).toEqual({ prefix: '{', post: 'hello' })
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

describe('pathParamNames', () => {
  it('reads the path as Hono does: nested braces, a class brace and an escaped one do not end a param', () => {
    expect([...pathParamNames('/api/users/:user/posts/:post?')]).toEqual(['user', 'post'])
    // the CodeRabbit example: `{` in a character class must not swallow the rest of the path
    expect([...pathParamNames('/pat/:prefix{[{]}/:post')]).toEqual(['prefix', 'post'])
    expect([...pathParamNames('/esc/:prefix{\\}}/:post')]).toEqual(['prefix', 'post'])
    expect([...pathParamNames('/nested/:id{[0-9]{2,4}}/:post')]).toEqual(['id', 'post'])
    // a `/` inside a pattern stays in its segment
    expect([...pathParamNames('/files/:file{.+/.+}/:post')]).toEqual(['file', 'post'])
  })
})

describe('expandedPathWithoutParam', () => {
  it("reads Hono's expansions: a required param after an optional one is reported, optional-only and required-first ones are not", () => {
    // `/mixed` is the first expansion of the CodeRabbit path that has no `post`
    expect(expandedPathWithoutParam('/mixed/:first?/:post/:last?', 'post')).toBe('/mixed')
    // An optional param may be absent: the proof types it `| undefined`
    expect(expandedPathWithoutParam('/mixed/:first?/:post/:last?', 'first')).toBeUndefined()
    expect(expandedPathWithoutParam('/mixed/:first?/:post/:last?', 'last')).toBeUndefined()
    // Every expansion carries a required param that precedes the optionals
    expect(expandedPathWithoutParam('/a/:post/:opt?', 'post')).toBeUndefined()
    expect(expandedPathWithoutParam('/a/:post/:opt?', 'opt')).toBeUndefined()
    // A static segment after an optional one: Hono registers `/a/:post` but its handler map keeps 0 params there
    // (`3 - 4 + 0 + 1`), so `post` is absent from `/a/one` even though the expansion names it
    expect(expandedPathWithoutParam('/a/:post/:first?/fixed/:last?', 'post')).toBe('/a/:post')
    expect(expandedPathWithoutParam('/a/:post/:first?/fixed/:last?', 'first')).toBeUndefined()
    expect(expandedPathWithoutParam('/a/:post/:first?/fixed/:last?', 'last')).toBeUndefined()
    // A name that also occurs required counts as required: PathParams intersects the two, so a handler sees a string
    expect(expandedPathWithoutParam('/dup/:post?/:post/:opt?', 'post')).toBe('/dup')
    // A path Hono registers as written has one registration, the path itself
    expect(expandedPathWithoutParam('/x/:post?/details', 'post')).toBeUndefined()
  })
})

describe('scope bindings', () => {
  it('the same bound builder for the scope and its contracts passes', async () => {
    const scoped = mount(Route.api(appApi, (r) => {
      const bound = r.bind({ user: User })
      return [bound.scope('users/[user]', { policy: PostPolicy }), bound.contract(posts, ScopeController)]
    }))
    expect(await (await scoped.request('/api/users/7/posts/hello')).json()).toEqual({ user: '7', post: 'hello' })
    expect(lookups).toEqual(['user:7'])
  })

  it('a scope binding the contract builder does not repeat is rejected at Route.api, before any request', () => {
    // The proof typed `user` as a string (the contract's builder binds nothing): the route would pass a model
    expect(() => Route.api(appApi, (r) => [
      r.bind({ user: User }).scope('users/[user]', { policy: PostPolicy }),
      r.contract(posts, ScopeController),
    ])).toThrow(
      '[@laratype/http] Route.api: scope "users/[user]" binds `user`, but contract "users.posts" is mounted from a builder that does not bind it: ' +
        "mount the contract from a builder that binds `user` too (a handler's types see only its own builder's bindings)",
    )
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
  class UnboundController extends Controller {
    index() { return {} }
    show() { return {} }
    latest() { return {} }
  }
  const mountWith = (bindings: unknown) =>
    Route.api(appApi, (r) => {
      // The unchecked bindings reach the contract at runtime, while the proof keeps the unbound builder type
      const bound = r.bind(bindings as never) as unknown as typeof r
      return [bound.contract(posts, UnboundController)]
    })

  it('needs a function', () => {
    expect(() => mountWith({ user: 42 })).toThrow(binderIssue('user'))
  })

  it('needs a map: a number, null, undefined or a string are refused before any entry is read', () => {
    const message = (got: string) => `[@laratype/http] Route.api: r.bind(): the bindings must be an object, one value per path param (got ${got})`
    expect(() => mountWith(42)).toThrow(message('42'))
    expect(() => mountWith(null)).toThrow(message('null'))
    expect(() => mountWith(undefined)).toThrow(message('undefined'))
    expect(() => mountWith('user')).toThrow(message('"user"'))
  })

  it('reads no `length` of the map: a { length: 1e9 } object is checked as one key named length', () => {
    // A loop sized by a length field would hang or allocate: the own names are read instead
    expect(() => mountWith({ length: 1e9 })).toThrow(binderIssue('length'))
  })

  it('refuses NaN and Infinity as binders', () => {
    expect(() => mountWith({ user: NaN })).toThrow(binderIssue('user'))
    expect(() => mountWith({ user: Infinity })).toThrow(binderIssue('user'))
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

  it('a key that is not a path param of the contract fails at mount instead of being dropped', () => {
    expect(() => mountWith({ comment: Post })).toThrow(
      '[@laratype/http] Route.api: r.bind(): `comment` is not a path param of any endpoint in users.posts',
    )
  })

  it('checks a very long unicode key like any other, without crashing', () => {
    // A lone surrogate, a control character and 10k characters: the own-names loop names the key in the path-param check
    const key = `\ud800\u0000${'x'.repeat(10_000)}`
    expect(() => mountWith({ [key]: User })).toThrow('is not a path param of any endpoint in users.posts')
  })

  it('a scope key that is not a path param under the folder fails at mount instead of being dropped', () => {
    expect(() => Route.api(appApi, (r) => {
      const bound = r.bind({ comment: Post } as never) as unknown as typeof r
      return [bound.scope('users/[user]', { policy: PostPolicy }), r.contract(posts, UnboundController)]
    })).toThrow(
      '[@laratype/http] Route.api: r.bind(): `comment` is not a path param of any endpoint under scope "users/[user]"',
    )
  })

  it('refuses `__proto__` as a binding key', () => {
    // Every object reads `__proto__` as its prototype: Hono drops such a path param. The key is refused before the
    // path-param check, since no route could ever resolve it
    expect(() => Route.api(appApi, (r) => [r.bind({ ['__proto__']: User }).contract(posts, UnboundController)])).toThrow(
      '[@laratype/http] Route.api: r.bind(): `__proto__` cannot be a binding key: every object reads it as its prototype, so the binding would be dropped. ' +
        'Fix: name the path param something else.',
    )
  })

  it('refuses an object literal `{ __proto__: User }`, which sets the prototype of the map', () => {
    // Object.entries() is empty for that literal: the map would bind nothing while the types say it binds `__proto__`
    expect(() => Route.api(appApi, (r) => [r.bind({ __proto__: User }).contract(posts, UnboundController)])).toThrow(
      '[@laratype/http] Route.api: r.bind(): `{ __proto__: User }` sets the prototype of the bindings map instead of binding a key. ' +
        'Fix: name the path param something else.',
    )
  })

  it('refuses a map with an object prototype, such as Object.create({ id: User })', () => {
    // The entry is inherited: the spread of r.bind() drops it, so the map would bind nothing while the types say it binds
    const map = Object.create({ user: User }) as Record<string, typeof User>
    expect(() => mountWith(map)).toThrow(
      '[@laratype/http] Route.api: r.bind(): the bindings map must have Object.prototype or null as its prototype, not a class instance or an Object.create(base) object (got an object that is not Object.prototype)',
    )
    // The message names the prototype it got: a class instance map is refused the same way
    class MapLike { user = User }
    expect(() => mountWith(new MapLike())).toThrow(
      '[@laratype/http] Route.api: r.bind(): the bindings map must have Object.prototype or null as its prototype, not a class instance or an Object.create(base) object (got MapLike.prototype)',
    )
  })

  it('refuses an own non-enumerable binding key, which the spread would drop', () => {
    // Object.entries() skips it, so the handler would get the raw string while the proof promises the model
    const map: Record<string, unknown> = {}
    Object.defineProperty(map, 'user', { value: User })
    expect(() => mountWith(map)).toThrow(
      '[@laratype/http] Route.api: r.bind(): `user` is a non-enumerable property of the bindings map: r.bind() copies enumerable own properties only, so the binding would be dropped. ' +
        'Fix: declare it as a plain property, { user: ... }.',
    )
  })

  it('a missing property descriptor (a Proxy phantom key) gives that diagnostic, not a TypeError', () => {
    // Object.getOwnPropertyNames() shows the key, getOwnPropertyDescriptor() returns undefined for it
    const map = new Proxy({ user: User } as Record<string, unknown>, {
      ownKeys: () => ['user', 'ghost'],
      getOwnPropertyDescriptor: (target, key) => (key === 'ghost' ? undefined : Reflect.getOwnPropertyDescriptor(target, key)),
    })
    expect(() => mountWith(map)).toThrow(
      '[@laratype/http] Route.api: r.bind(): `ghost` is a non-enumerable property of the bindings map: r.bind() copies enumerable own properties only, so the binding would be dropped. ' +
        'Fix: declare it as a plain property, { ghost: ... }.',
    )
  })

  it('refuses a binding on an optional param Hono registers as `:post?`, and binds the paths it expands', async () => {
    const mid = defineContract()({ show: endpoint.get('/:post?/details').response(anything) })
    const midApi = defineApi({ mid: { contract: mid, path: '/mid', scopes: [] } })
    class MidController extends Controller {
      show(ctx: Ctx<typeof mid.show, { params: { post: Post | undefined } }>) { return { post: ctx.params.post?.slug ?? null } }
    }
    expect(() => Route.api(midApi, (r) => [r.bind({ post: Post }).contract(mid, MidController)])).toThrow(
      '[@laratype/http] Route.api: r.bind(): `post` binds `:post?` in /mid/:post?/details, where Hono registers it as `post?`: ' +
        'it expands only a path that ends with an optional param, so the binding would never run. Fix: make the optional param the last segment, or drop the `?`.',
    )
    // `/latest/:post?` ends with the optional segment: Hono drops the `?`, and the binding runs
    expect(await (await app.request('/api/users/7/posts/latest/hello')).json()).toEqual({ user: '7', post: 'hello' })

    // Two optionals, the path ending with one: Hono expands every segment and strips both `?`s, so both bindings run
    const nested = defineContract()({ show: endpoint.get('/:first?/:second?').response(anything) })
    const nestedApi = defineApi({ nested: { contract: nested, path: '/nested', scopes: [] } })
    class NestedController extends Controller {
      show(ctx: Ctx<typeof nested.show, { params: { first: Post | undefined; second: Post | undefined } }>) {
        return { first: ctx.params.first?.slug ?? null, second: ctx.params.second?.slug ?? null }
      }
    }
    const routes = mount(Route.api(nestedApi, (r) => [r.bind({ first: Post, second: Post }).contract(nested, NestedController)]))
    expect(await (await routes.request('/nested/one/two')).json()).toEqual({ first: 'one', second: 'two' })
    expect(await (await routes.request('/nested/one')).json()).toEqual({ first: 'one', second: null })

    // The same optional param before a trailing slash: the path does not end with `?`, so Hono keeps it in the name
    const slashed = defineContract()({ show: endpoint.get('/:post?/').response(anything) })
    const slashedApi = defineApi({ slashed: { contract: slashed, path: '/slashed', scopes: [] } })
    class SlashedController extends Controller {
      show(ctx: Ctx<typeof slashed.show, { params: { post: Post | undefined } }>) { return { post: ctx.params.post?.slug ?? null } }
    }
    expect(() => Route.api(slashedApi, (r) => [r.bind({ post: Post }).contract(slashed, SlashedController)])).toThrow(
      '[@laratype/http] Route.api: r.bind(): `post` binds `:post?` in /slashed/:post?/, where Hono registers it as `post?`: ' +
        'it expands only a path that ends with an optional param, so the binding would never run. Fix: make the optional param the last segment, or drop the `?`.',
    )
  })

  it('refuses a required binding after an optional param, and binds the expanded layouts that carry it', async () => {
    // CodeRabbit round 4: /mixed/:first?/:post/:last? is also registered as /mixed and /mixed/:first, which have no
    // `post`, so a binding on it would resolve `undefined` where the proof promises Post
    const mixed = defineContract()({ show: endpoint.get('/:first?/:post/:last?').response(anything) })
    const mixedApi = defineApi({ mixed: { contract: mixed, path: '/mixed', scopes: [] } })
    class MixedController extends Controller {
      show(ctx: Ctx<typeof mixed.show, { params: { first: Post | undefined; post: Post; last: Post | undefined } }>) {
        return { first: ctx.params.first?.slug ?? null, post: ctx.params.post.slug, last: ctx.params.last?.slug ?? null }
      }
    }
    expect(() => Route.api(mixedApi, (r) => [r.bind({ post: Post }).contract(mixed, MixedController)])).toThrow(
      '[@laratype/http] Route.api: r.bind(): `post` is a required param of /mixed/:first?/:post/:last? that Hono\'s optional-param expansion leaves out of a registration: ' +
        'Hono also registers `/mixed`, where its router passes no `post` to the handler, so the binding would give `undefined` where the proof promises a model. ' +
        'Fix: move `post` before the optional params, or drop their `?`.',
    )

    // The optional bindings of the same layout stay valid: the proof types an absent one `| undefined`
    class OptionalMixedController extends Controller {
      show(ctx: Ctx<typeof mixed.show, { params: { first: Post | undefined; last: Post | undefined } }>) {
        return { first: ctx.params.first?.slug ?? null, last: ctx.params.last?.slug ?? null }
      }
    }
    const optionalOnly = mount(Route.api(mixedApi, (r) => [r.bind({ first: Post, last: Post }).contract(mixed, OptionalMixedController)]))
    expect(await (await optionalOnly.request('/mixed')).json()).toEqual({ first: null, last: null })
    expect(await (await optionalOnly.request('/mixed/one')).json()).toEqual({ first: 'one', last: null })
    expect(await (await optionalOnly.request('/mixed/one/two/three')).json()).toEqual({ first: 'one', last: 'three' })

    // /a/:post/:opt?: every expansion carries the required `post`, and the trailing optional binds when present
    const trailing = defineContract()({ show: endpoint.get('/:post/:opt?').response(anything) })
    const trailingApi = defineApi({ trailing: { contract: trailing, path: '/a', scopes: [] } })
    class TrailingController extends Controller {
      show(ctx: Ctx<typeof trailing.show, { params: { post: Post; opt: Post | undefined } }>) {
        return { post: ctx.params.post.slug, opt: ctx.params.opt?.slug ?? null }
      }
    }
    const routes = mount(Route.api(trailingApi, (r) => [r.bind({ post: Post, opt: Post }).contract(trailing, TrailingController)]))
    expect(await (await routes.request('/a/one')).json()).toEqual({ post: 'one', opt: null })
    expect(await (await routes.request('/a/one/two')).json()).toEqual({ post: 'one', opt: 'two' })
  })

  it("refuses a required binding Hono's param map drops (a static segment after an optional one)", () => {
    // Hono 4.9.6 expands /a/:post/:first?/fixed/:last? to /a/:post too, but its RegExpRouter keeps 0 params for that
    // registration (`3 - 4 + 0 + 1`): a request to /a/one has no `post` in c.req.param(), so the map names the expansion
    // even though its path carries `:post`
    const mixed = defineContract()({ show: endpoint.get('/:post/:first?/fixed/:last?').response(anything) })
    const mixedApi = defineApi({ mixed: { contract: mixed, path: '/a', scopes: [] } })
    class StaticController extends Controller {
      show(ctx: Ctx<typeof mixed.show, { params: { post: Post; first: Post | undefined; last: Post | undefined } }>) {
        return { post: ctx.params.post.slug, first: ctx.params.first?.slug ?? null, last: ctx.params.last?.slug ?? null }
      }
    }
    expect(() => Route.api(mixedApi, (r) => [r.bind({ post: Post }).contract(mixed, StaticController)])).toThrow(
      '[@laratype/http] Route.api: r.bind(): `post` is a required param of /a/:post/:first?/fixed/:last? that Hono\'s optional-param expansion leaves out of a registration: ' +
        'Hono also registers `/a/:post`, where its router passes no `post` to the handler, so the binding would give `undefined` where the proof promises a model. ' +
        'Fix: move `post` before the optional params, or drop their `?`.',
    )

    // The optional bindings of the same layout stay valid: an absent optional param is `undefined` by the proof
    class StaticOptionalController extends Controller {
      show(ctx: Ctx<typeof mixed.show, { params: { first: Post | undefined; last: Post | undefined } }>) {
        return { first: ctx.params.first?.slug ?? null, last: ctx.params.last?.slug ?? null }
      }
    }
    expect(() => Route.api(mixedApi, (r) => [r.bind({ first: Post, last: Post }).contract(mixed, StaticOptionalController)])).not.toThrow()
  })

  it('binds a null-prototype map', async () => {
    // Object.create(null) is a plain map: its own enumerable keys are spread like any other's
    const map: Record<string, unknown> = Object.create(null)
    map.user = User
    const routes = mount(Route.api(appApi, (r) => {
      const bound = r.bind(map as never) as unknown as typeof r
      return [bound.contract(posts, ScopeController)]
    }))
    const res = await routes.request('/api/users/7/posts/hello')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: '7', post: 'hello' })
    expect(lookups).toEqual(['user:7'])
  })
})

describe('the bindings of an item built by hand (no r.contract() / r.scope())', () => {
  class PlainController extends Controller {
    index() { return {} }
    show(ctx: { params: Record<string, unknown> }) { return { user: (ctx.params.user as User).id } }
    latest() { return {} }
  }
  // An untyped caller builds the items itself: the array is cast, as its own would be
  const items = (list: unknown[]) => list as never

  it('a contract item with a non-binder value throws at mount, as r.bind() does', () => {
    expect(() => Route.api(appApi, () => items([
      { kind: 'contract', contract: posts, controller: PlainController, middleware: [], bindings: { user: 42 } },
    ]))).toThrow(binderIssue('user'))
  })

  it('a scope item with a non-binder value throws at mount, as r.bind() does', () => {
    expect(() => Route.api(appApi, () => items([
      { kind: 'scope', dir: 'users/[user]', policy: PostPolicy, middleware: [], bindings: { user: 42 } },
      { kind: 'contract', contract: posts, controller: PlainController, middleware: [], bindings: {} },
    ]))).toThrow(binderIssue('user'))
  })

  it('a hand-built item with a `__proto__` key is refused at mount too', () => {
    expect(() => Route.api(appApi, () => items([
      { kind: 'contract', contract: posts, controller: PlainController, middleware: [], bindings: { ['__proto__']: User } },
    ]))).toThrow(
      '[@laratype/http] Route.api: r.bind(): `__proto__` cannot be a binding key: every object reads it as its prototype, so the binding would be dropped. ' +
        'Fix: name the path param something else.',
    )
  })

  it('a hand-built item whose bindings are not an object is refused at mount', () => {
    // 42 would otherwise pass planning (Object.entries(42) is empty) and bind nothing while the item says it binds
    expect(() => Route.api(appApi, () => items([
      { kind: 'contract', contract: posts, controller: PlainController, middleware: [], bindings: 42 },
    ]))).toThrow('[@laratype/http] Route.api: r.bind(): the bindings must be an object, one value per path param (got 42)')
    // null is not a map either; only an omitted `bindings` defaults to the empty one
    expect(() => Route.api(appApi, () => items([
      { kind: 'scope', dir: 'users/[user]', policy: PostPolicy, middleware: [], bindings: null },
      { kind: 'contract', contract: posts, controller: PlainController, middleware: [], bindings: {} },
    ]))).toThrow('[@laratype/http] Route.api: r.bind(): the bindings must be an object, one value per path param (got null)')
  })

  it('a hand-built item with a valid binder mounts and binds', async () => {
    const routes = mount(Route.api(appApi, () => items([
      { kind: 'contract', contract: posts, controller: PlainController, middleware: [], bindings: { user: User } },
    ])))
    expect(await (await routes.request('/api/users/7/posts/hello')).json()).toEqual({ user: '7' })
    expect(lookups).toEqual(['user:7'])
  })

  it('binds the checked snapshot: a map mutated from an endpoints callback changes no route', async () => {
    // The callbacks run after every item is planned: the checked copy is what the route binds, not the mutated map
    const bindings: Record<string, unknown> = { user: User }
    const swapped = (raw: string) => {
      lookups.push(`swapped:${raw}`)
      return new OtherPost()
    }
    const routes = mount(Route.api(appApi, () => items([
      {
        kind: 'contract', contract: posts, controller: PlainController, middleware: [], bindings,
        options: { endpoints: { show: (b: unknown) => { bindings.user = swapped; return b } } },
      },
    ])))
    expect(await (await routes.request('/api/users/7/posts/hello')).json()).toEqual({ user: '7' })
    expect(lookups).toEqual(['user:7'])
  })

  it('reads a contract item bindings getter once: the checked map is the one the route binds', async () => {
    const first: Record<string, unknown> = { user: User }
    const second: Record<string, unknown> = {
      user: (raw: string) => {
        lookups.push(`second:${raw}`)
        return new OtherPost()
      },
    }
    let reads = 0
    const item: Record<string, unknown> = { kind: 'contract', contract: posts, controller: PlainController, middleware: [] }
    Object.defineProperty(item, 'bindings', { enumerable: true, get: () => (reads++ === 0 ? first : second) })
    const routes = mount(Route.api(appApi, () => items([item])))
    expect(await (await routes.request('/api/users/7/posts/hello')).json()).toEqual({ user: '7' })
    expect(reads).toBe(1)
    expect(lookups).toEqual(['user:7'])
  })

  it('reads a scope item bindings getter once, as a contract item', () => {
    const first: Record<string, unknown> = { user: User }
    const second: Record<string, unknown> = { user: 42 }
    let reads = 0
    const scope: Record<string, unknown> = { kind: 'scope', dir: 'users/[user]', policy: PostPolicy, middleware: [] }
    Object.defineProperty(scope, 'bindings', { enumerable: true, get: () => (reads++ === 0 ? first : second) })
    // The contract binds the same key, as a scope binding requires: the second, unchecked map never reaches a check
    expect(() => Route.api(appApi, () => items([
      scope,
      { kind: 'contract', contract: posts, controller: PlainController, middleware: [], bindings: { user: User } },
    ]))).not.toThrow()
    expect(reads).toBe(1)
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
