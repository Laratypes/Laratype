import { describe, expect, it } from 'vitest'
import * as z from 'zod'
import {
  API_NODE,
  CONTRACT,
  ENDPOINT,
  SCOPE,
  apiEndpoint,
  apiPaths,
  apiRoutes,
  contractEndpoints,
  defineApi,
  defineContract,
  defineError,
  defineScope,
  endpoint,
  errors,
  isContract,
  isEndpoint,
  isScope,
} from '@laratype/contract'
import { appApi } from './fixtures/app/api'
import { AccountLocked, EmailTaken, PostLimit } from './fixtures/app/api/errors'
import users from './fixtures/app/api/users'
import usersUser from './fixtures/app/api/users/[user]/_scope'
import posts from './fixtures/app/api/users/[user]/posts'
import type { Prefix as UserPrefix } from './fixtures/app/api/users/[user]/$types'

describe('defineContract', () => {
  it('keeps the endpoints and brands the options with a non-enumerable symbol', () => {
    expect(users.show.def).toMatchObject({ method: 'get', path: '/:user', throws: [] })
    expect(Object.keys(users)).toEqual(['index', 'show', 'store', 'destroy', 'stats'])
    expect(users[CONTRACT].options).toEqual({ auth: true, throttle: { limit: 60, per: '1m' } })
    expect(posts[CONTRACT].options).toEqual({ throws: [PostLimit] })
    expect(Object.getOwnPropertyDescriptor(users, CONTRACT)?.enumerable).toBe(false)
    expect(isContract({ ...users })).toBe(false)
  })

  it('is frozen and has a null prototype, options included', () => {
    expect(Object.isFrozen(users)).toBe(true)
    expect(Object.getPrototypeOf(users)).toBeNull()
    expect(Object.isFrozen(users[CONTRACT].options)).toBe(true)
    expect(Object.isFrozen(posts[CONTRACT].options.throws)).toBe(true)
    expect(() => {
      (users as Record<string, unknown>).extra = endpoint.get('/x')
    }).toThrow(TypeError)
  })

  it('keeps the 200 default when .response() ends the chain (NoInfer regression)', () => {
    expect(users.index.def.status).toBe(200)
    expect(posts.index.def.status).toBe(200)
    expect(users.store.def.status).toBe(201)
  })

  it('lists endpoints in definition order', () => {
    expect(contractEndpoints(posts)).toEqual([
      ['index', posts.index],
      ['store', posts.store],
      ['search', posts.search],
    ])
  })

  it('works without options', () => {
    expect(defineContract()({ a: endpoint.get('/') })[CONTRACT].options).toEqual({})
  })

  it('rejects bad endpoint keys, non-endpoint values and bad options', () => {
    expect(() => defineContract()({ 'a.b': endpoint.get('/') })).toThrow(/endpoint key "a.b" must be non-empty and must not contain "."/)
    expect(() => defineContract()({ '': endpoint.get('/') })).toThrow(/endpoint key ""/)
    expect(() => defineContract()({ a: { def: {} } as never })).toThrow(/"a" is not an endpoint/)
    expect(() => defineContract()({}, { authorize: true } as never)).toThrow(/defineContract: unknown option "authorize"/)
    expect(() => defineContract()({}, { auth: false } as never)).toThrow(/auth must be true or a guard name/)
    expect(() => defineContract()({}, { throttle: { limit: 0, per: 60 } })).toThrow(/throttle must be/)
    expect(() => defineContract()({}, { throws: [{ status: 409, code: 'X' }] as never })).toThrow(/use defineError/)
  })
})

describe('defineScope', () => {
  it('returns the options, frozen and branded', () => {
    expect(usersUser).toEqual({ auth: true, authorize: true, throws: [AccountLocked] })
    expect(usersUser[SCOPE]).toBe(true)
    expect(Object.getOwnPropertyDescriptor(usersUser, SCOPE)?.enumerable).toBe(false)
    expect(Object.isFrozen(usersUser)).toBe(true)
    expect(isScope(usersUser)).toBe(true)
    expect(isScope({ ...usersUser })).toBe(false)
    expect(isContract(usersUser)).toBe(false)
  })

  it('rejects unknown options and opt-outs', () => {
    expect(() => defineScope()({ public: true } as never)).toThrow(/defineScope: unknown option "public"/)
    expect(() => defineScope()({ throttle: false } as never)).toThrow(/throttle must be/)
    expect(() => defineScope()({ authorize: 'yes' } as never)).toThrow(/authorize must be a boolean/)
  })
})

describe('defineApi', () => {
  it('nests the flat tree names: api.users.posts.store', () => {
    expect(appApi.users.show).toBe(users.show)
    expect(appApi.users.posts.store).toBe(posts.store)
    expect(Object.keys(appApi)).toEqual(['users'])
    expect(Object.keys(appApi.users)).toEqual(['index', 'show', 'store', 'destroy', 'stats', 'posts'])
  })

  it('brands each node with its tree name and entry, and freezes the tree', () => {
    expect(appApi.users[API_NODE]).toEqual({ name: 'users', entry: { contract: users, path: '/api/users', scopes: [], dirs: [] } })
    expect(appApi.users.posts[API_NODE].entry.dirs).toEqual(['users/[user]'])
    expect(appApi.users.posts[API_NODE].name).toBe('users.posts')
    expect(appApi.users.posts[API_NODE].entry.scopes).toEqual([usersUser])
    expect(Object.keys(appApi.users.posts)).toEqual(['index', 'store', 'search'])
    expect(Object.isFrozen(appApi)).toBe(true)
    expect(Object.isFrozen(appApi.users.posts)).toBe(true)
    expect(Object.getPrototypeOf(appApi.users)).toBeNull()
  })

  it('creates pure folder nodes, whatever the entry order', () => {
    const health = defineContract()({ check: endpoint.get('/') })
    const api = defineApi({
      'v1.health.deep': { contract: health, path: '/api/v1/health/deep', scopes: [], dirs: [] },
      'v1.health': { contract: health, path: '/api/v1/health', scopes: [], dirs: [] },
    })
    expect(api.v1[API_NODE]).toEqual({ name: 'v1', entry: undefined })
    expect(apiRoutes(api).map((r) => [r.name, r.path])).toEqual([
      ['v1.health.deep.check', '/api/v1/health/deep'],
      ['v1.health.check', '/api/v1/health'],
    ])
  })

  it('rejects bad names, entries and endpoint/child name clashes', () => {
    const c = defineContract()({ show: endpoint.get('/') })
    expect(() => defineApi({ 'a..b': { contract: c, path: '/a', scopes: [], dirs: [] } } as never)).toThrow(/invalid tree name "a..b"/)
    expect(() => defineApi({ a: c } as never)).toThrow(/"a" must be \{ contract, path, scopes, dirs \}/)
    expect(() => defineApi({ a: { contract: c, path: 'a', scopes: [], dirs: [] } })).toThrow(/path must start with "\/"/)
    expect(() => defineApi({ a: { contract: c, path: '/a', scopes: [{ auth: true }], dirs: [''] } } as never)).toThrow(/use defineScope/)
    expect(() => defineApi({ a: { contract: c, path: '/a', scopes: [], dirs: [] }, 'a.show': { contract: c, path: '/a/show', scopes: [], dirs: [] } } as never)).toThrow(
      /"a.show" is both an endpoint and a contract/,
    )
    expect(() => defineApi({ 'a.show': { contract: c, path: '/a/show', scopes: [], dirs: [] }, a: { contract: c, path: '/a', scopes: [], dirs: [] } } as never)).toThrow(
      /"a.show" is both an endpoint and a contract/,
    )
  })

  it('needs dirs: one root-relative folder per scope (H1 #104)', () => {
    const c = defineContract()({ show: endpoint.get('/') })
    const scope = defineScope()({ auth: true })
    expect(() => defineApi({ a: { contract: c, path: '/a', scopes: [scope] } } as never)).toThrow(
      /"a" needs dirs: the folder of each scope \("" for the root\)/,
    )
    expect(() => defineApi({ a: { contract: c, path: '/a', scopes: [scope], dirs: [] } } as never)).toThrow(
      /"a" dirs must hold one folder per scope \(1 scopes, 0 dirs\)/,
    )
    expect(() => defineApi({ a: { contract: c, path: '/a', scopes: [], dirs: [''] } } as never)).toThrow(/"a" dirs must hold one folder per scope/)
    expect(() => defineApi({ a: { contract: c, path: '/a', scopes: [scope], dirs: ['/a'] } })).toThrow(/"a" dirs must be root-relative folders/)
    expect(() => defineApi({ a: { contract: c, path: '/a', scopes: [scope, scope], dirs: ['', ''] } })).toThrow('[@laratype/contract] defineApi: "a" dirs must not repeat a folder ("")')
    expect(() => defineApi({ a: { contract: c, path: '/a', scopes: [scope], dirs: [1] } } as never)).toThrow(/"a" dirs must be root-relative folders/)
    expect(defineApi({ a: { contract: c, path: '/a', scopes: [scope], dirs: [''] } }).a[API_NODE].entry.dirs).toEqual([''])
  })

  it('re-checks the capability rules against the real scope chain', () => {
    const open = defineContract()({ stats: endpoint.get('/stats').public() })
    const authorize = defineScope()({ auth: true, authorize: true })
    expect(() => defineApi({ x: { contract: open, path: '/x', scopes: [authorize], dirs: [''] } })).toThrow(
      /x.stats: .public\(\) under a scope with authorize: add .authorize\(false\)/,
    )
    expect(() => defineApi({ x: { contract: defineContract()({ d: endpoint.delete('/').authorize() }), path: '/x', scopes: [], dirs: [] } })).toThrow(
      /x.d: .authorize\(\) needs auth on the endpoint, its contract or a scope/,
    )
    const bare = defineScope()({ authorize: true } as never)
    expect(() => defineApi({ x: { contract: open, path: '/x', scopes: [bare], dirs: [''] } })).toThrow(/scope 0 has authorize but no auth/)
    const allowed = defineContract()({ stats: endpoint.get('/stats').public().authorize(false) })
    expect(() => defineApi({ x: { contract: allowed, path: '/x', scopes: [authorize], dirs: [''] } })).not.toThrow()
  })
})

describe('apiRoutes', () => {
  const routes = apiRoutes(appApi)
  const route = (name: string) => routes.find((r) => r.name === name)!

  it('lists every route depth-first in definition order, with full paths', () => {
    expect(routes.map((r) => [r.name, r.method, r.path])).toEqual([
      ['users.index', 'get', '/api/users'],
      ['users.show', 'get', '/api/users/:user'],
      ['users.store', 'post', '/api/users'],
      ['users.destroy', 'delete', '/api/users/:user'],
      ['users.stats', 'get', '/api/users/stats'],
      ['users.posts.index', 'get', '/api/users/:user/posts'],
      ['users.posts.store', 'post', '/api/users/:user/posts'],
      ['users.posts.search', 'get', '/api/users/:user/posts/search'],
    ])
    expect(route('users.show').endpoint).toBe(users.show)
    expect(route('users.posts.index').contract).toBe(posts)
    expect(route('users.posts.index').scopes).toEqual([usersUser])
    expect(Object.isFrozen(route('users.show'))).toBe(true)
  })

  it('resolves the inherited capabilities: nearest auth and throttle, authorize from every level', () => {
    expect(route('users.index')).toMatchObject({ auth: true, authorize: false, throttle: { limit: 60, per: '1m' } })
    expect(route('users.destroy')).toMatchObject({ auth: true, authorize: true })
    expect(route('users.stats')).toMatchObject({ auth: undefined, authorize: false, throttle: undefined })
    expect(route('users.posts.index')).toMatchObject({ auth: true, authorize: false, throttle: undefined })
    expect(route('users.posts.store')).toMatchObject({ auth: true, authorize: true, throttle: { limit: 10, per: 60 } })
    expect(route('users.posts.search')).toMatchObject({ auth: undefined, authorize: false })
  })

  it('derives the errors (422, 404, 401, 403, 429) and adds throws from every level, unique by code', () => {
    const codes = (name: string) => route(name).errors.map((e) => e.code)
    expect(codes('users.index')).toEqual(['VALIDATION_ERROR', 'UNAUTHORIZED', 'TOO_MANY_REQUESTS'])
    expect(codes('users.store')).toEqual(['VALIDATION_ERROR', 'UNAUTHORIZED', 'TOO_MANY_REQUESTS', 'EMAIL_TAKEN'])
    expect(codes('users.destroy')).toEqual(['NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN', 'TOO_MANY_REQUESTS'])
    expect(codes('users.stats')).toEqual([])
    expect(codes('users.posts.index')).toEqual(['VALIDATION_ERROR', 'NOT_FOUND', 'UNAUTHORIZED', 'ACCOUNT_LOCKED', 'POST_LIMIT'])
    expect(codes('users.posts.store')).toEqual([
      'VALIDATION_ERROR', 'NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN', 'TOO_MANY_REQUESTS', 'ACCOUNT_LOCKED', 'POST_LIMIT',
    ])
    // .throws(errors.notFound) on top of the derived 404: kept once
    expect(codes('users.posts.search')).toEqual(['NOT_FOUND', 'ACCOUNT_LOCKED', 'POST_LIMIT'])
    expect(route('users.store').errors).toContain(EmailTaken)
    expect(route('users.index').errors[0]).toBe(errors.validation)
  })

  it('is apiPaths() plus the resolved capabilities: same names, methods and paths', () => {
    expect(routes.map((r) => [r.name, r.method, r.path])).toEqual(apiPaths(appApi).map((p) => [p.name, p.method, p.path]))
    expect(apiPaths(appApi.users.posts)[0]).toMatchObject({ path: '/api/users/:user/posts', contract: posts, scopes: [usersUser] })
  })

  it('takes an API node (full names) or a single contract (endpoint keys, its own paths)', () => {
    expect(apiRoutes(appApi.users.posts).map((r) => r.name)).toEqual(['users.posts.index', 'users.posts.store', 'users.posts.search'])
    const own = apiRoutes(users)
    expect(own.map((r) => [r.name, r.method, r.path])).toEqual([
      ['index', 'get', '/'],
      ['show', 'get', '/:user'],
      ['store', 'post', '/'],
      ['destroy', 'delete', '/:user'],
      ['stats', 'get', '/stats'],
    ])
    // the contract options still apply: auth and throttle
    expect(own[0]!.errors.map((e) => e.code)).toEqual(['VALIDATION_ERROR', 'UNAUTHORIZED', 'TOO_MANY_REQUESTS'])
    expect(own[0]).toMatchObject({ contract: users, scopes: [] })
  })

  it('treats "/" as the contract prefix itself and keeps optional params', () => {
    const c = defineContract()({ root: endpoint.get('/'), opt: endpoint.get('/:id?') })
    const api = defineApi({ things: { contract: c, path: '/api/things', scopes: [], dirs: [] } })
    expect(apiRoutes(api).map((r) => [r.path, r.errors.map((e) => e.code)])).toEqual([
      ['/api/things', []],
      ['/api/things/:id?', ['NOT_FOUND']],
    ])
  })
})

describe('apiPaths', () => {
  it('lists names, methods and full paths without resolving capabilities', () => {
    // .authorize() gets auth from the folder scope: fine in its folder, inconsistent alone
    const scoped = defineContract<UserPrefix>()({ destroy: endpoint.delete('/:post').authorize() })
    expect(apiPaths(scoped).map((p) => [p.name, p.method, p.path])).toEqual([['destroy', 'delete', '/:post']])
    expect(() => apiRoutes(scoped)).toThrow(/needs auth/)
    expect(Object.isFrozen(apiPaths(scoped)[0])).toBe(true)
  })
})

describe('ENDPOINT brand', () => {
  // An endpoint from another bundle or package copy (ESM + CJS): same Symbol.for brand, different class
  const foreign = () => {
    const value = { def: endpoint.get('/x').def }
    Object.defineProperty(value, Symbol.for('laratype.endpoint'), { value: true })
    return value
  }

  it('recognizes endpoints by a non-enumerable Symbol.for brand, not instanceof', () => {
    const e = endpoint.get('/')
    expect((e as unknown as Record<symbol, unknown>)[ENDPOINT]).toBe(true)
    expect(ENDPOINT).toBe(Symbol.for('laratype.endpoint'))
    expect(Object.keys(e)).toEqual(['def'])
    expect(isEndpoint(e)).toBe(true)
    expect(isEndpoint(foreign())).toBe(true)
    expect(isEndpoint({ def: e.def })).toBe(false)
    expect(isEndpoint(null)).toBe(false)
  })

  it('accepts an endpoint from another package copy in defineContract, defineApi and apiRoutes', () => {
    const c = defineContract()({ x: foreign() as never })
    const api = defineApi({ things: { contract: c, path: '/api/things', scopes: [], dirs: [] } })
    expect(apiRoutes(api).map((r) => [r.name, r.path])).toEqual([['things.x', '/api/things/x']])
    expect(apiEndpoint(api, 'things.x')).toBe(c.x)
  })
})

describe('apiEndpoint', () => {
  it('resolves endpoints by route name', () => {
    expect(apiEndpoint(appApi, 'users.posts.store')).toBe(posts.store)
    expect(apiEndpoint(appApi, 'users.show')).toBe(users.show)
  })

  it('throws on an unknown route name or a node', () => {
    expect(() => apiEndpoint(appApi, 'users.nope' as never)).toThrow(/unknown route name "users.nope"/)
    expect(() => apiEndpoint(appApi, 'nope' as never)).toThrow(/unknown route name "nope"/)
    expect(() => apiEndpoint(appApi, 'users.posts' as never)).toThrow(/unknown route name "users.posts"/)
    expect(() => apiEndpoint(appApi, 'users.show.x' as never)).toThrow(/unknown route name "users.show.x"/)
  })

  it('carries what a value-import client needs: method, path, error codes and the schemas', async () => {
    const store = apiEndpoint(appApi, 'users.store').def
    expect([store.method, store.path, store.status, store.throws.map((e) => e.code)]).toEqual(['post', '/', 201, ['EMAIL_TAKEN']])
    const checked = await store.body!['~standard'].validate({ name: '', email: 'nope' })
    expect(checked.issues?.length).toBe(2)
    const ok = await store.body!['~standard'].validate({ name: 'Ada', email: 'ada@example.com' })
    expect(ok).toEqual({ value: { name: 'Ada', email: 'ada@example.com' } })
  })

  it('works with an inline contract and schema', () => {
    const api = defineApi({ health: { contract: defineContract()({ check: endpoint.get('/').response(z.object({ ok: z.boolean() })) }), path: '/health', scopes: [], dirs: [] } })
    expect(apiEndpoint(api, 'health.check').def.status).toBe(200)
    expect(defineError(409, 'X').code).toBe('X')
  })
})
