import { describe, expect, it } from 'vitest'
import * as z from 'zod'
import {
  API_NODE,
  API_ROOT,
  CONTRACT,
  ENDPOINT,
  SCOPE,
  apiEndpoint,
  apiPaths,
  apiRoutes,
  buildUrl,
  endpointErrors,
  routeErrors,
  contractEndpoints,
  defineApi,
  defineContract,
  defineError,
  defineScope,
  endpoint,
  errors,
  isApiNode,
  isApiRoot,
  isContract,
  isEndpoint,
  isScope,
  joinPath,
  resolveCapabilities,
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
    // a forged or older-copy endpoint skips the constructor's path check
    const forged = Object.defineProperty({ def: { method: 'get', path: ':tenant/x', status: 204, throws: [] } }, ENDPOINT, { value: true })
    expect(() => defineContract()({ a: forged as never })).toThrow(
      new TypeError('[@laratype/contract] defineContract: "a": the path must start with one "/", got ":tenant/x"'),
    )
    const getBody = Object.defineProperty({ def: { method: 'get', path: '/x', body: z.object({}), status: 204, throws: [] } }, ENDPOINT, { value: true })
    expect(() => defineContract()({ a: getBody as never })).toThrow(
      new TypeError('[@laratype/contract] defineContract: "a": a GET endpoint cannot have a body'),
    )
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
    expect(appApi.users[API_NODE]).toEqual({ name: 'users', entry: { contract: users, path: '/api/users', scopes: [] } })
    expect(appApi.users.posts[API_NODE].name).toBe('users.posts')
    expect(appApi.users.posts[API_NODE].entry.scopes).toEqual([{ scope: usersUser, dir: 'users/[user]' }])
    expect(Object.isFrozen(appApi.users.posts[API_NODE].entry.scopes[0])).toBe(true)
    expect(Object.keys(appApi.users.posts)).toEqual(['index', 'store', 'search'])
    expect(Object.isFrozen(appApi)).toBe(true)
    expect(Object.isFrozen(appApi.users.posts)).toBe(true)
    expect(Object.getPrototypeOf(appApi.users)).toBeNull()
  })

  it('creates pure folder nodes, whatever the entry order', () => {
    const health = defineContract()({ check: endpoint.get('/') })
    const api = defineApi({
      'v1.health.deep': { contract: health, path: '/api/v1/health/deep', scopes: [] },
      'v1.health': { contract: health, path: '/api/v1/health', scopes: [] },
    })
    expect(api.v1[API_NODE]).toEqual({ name: 'v1', entry: undefined })
    expect(apiRoutes(api).map((r) => [r.name, r.path])).toEqual([
      ['v1.health.deep.check', '/api/v1/health/deep'],
      ['v1.health.check', '/api/v1/health'],
    ])
  })

  it('rejects bad names, entries and endpoint/child name clashes', () => {
    const c = defineContract()({ show: endpoint.get('/') })
    expect(() => defineApi({ 'a..b': { contract: c, path: '/a', scopes: [] } } as never)).toThrow(/invalid tree name "a..b"/)
    expect(() => defineApi({ a: c } as never)).toThrow(/"a" must be \{ contract, path, scopes: \[\{ scope, dir \}\] \}/)
    expect(() => defineApi({ a: { contract: c, path: 'a', scopes: [] } })).toThrow(/the path must start with one "\/"/)
    // the endpoint path rule: one leading "/", no control characters (URL parsing drops tab, LF and CR)
    for (const path of ['', '//api', '/\\api', '/\t/evil.com', '/\n/evil.com']) {
      expect(() => defineApi({ a: { contract: c, path, scopes: [] } } as never)).toThrow(/defineApi: "a": the path must (start with one "\/"|not contain control characters)/)
    }
    // like the scan's base: no trailing "/" (or "\\"), which would double the join ("/" + "/users" is "//users", another host)
    for (const path of ['/', '/api/', '/api\\']) {
      expect(() => defineApi({ a: { contract: c, path, scopes: [] } } as never)).toThrow(
        new TypeError(`[@laratype/contract] defineApi: "a": the path must not end with "/" or "\\", got ${JSON.stringify(path)}`),
      )
    }
    // a valid entry path still builds same-host URLs
    const ok = defineApi({ a: { contract: defineContract()({ index: endpoint.get('/'), show: endpoint.get('/:id') }), path: '/api', scopes: [] } })
    expect(apiPaths(ok).map((r) => buildUrl(r.path, { params: { id: 7 } }))).toEqual(['/api', '/api/7'])
    expect(() => defineApi({ a: { contract: c, path: '/a', scopes: [{ scope: { auth: true }, dir: '' }] } } as never)).toThrow(/use defineScope/)
    expect(() => defineApi({ a: { contract: c, path: '/a', scopes: [] }, 'a.show': { contract: c, path: '/a/show', scopes: [] } } as never)).toThrow(
      /"a.show" is both an endpoint and a contract/,
    )
    expect(() => defineApi({ 'a.show': { contract: c, path: '/a/show', scopes: [] }, a: { contract: c, path: '/a', scopes: [] } } as never)).toThrow(
      /"a.show" is both an endpoint and a contract/,
    )
  })

  it('takes each scope with its root-relative folder: scopes: [{ scope, dir }] (H1 #104, C10 #258)', () => {
    const c = defineContract()({ show: endpoint.get('/') })
    const scope = defineScope()({ auth: true })
    // a bare scope, a null item, a hole in a sparse array
    for (const scopes of [scope, [scope], [null], Object.assign(new Array(2), { 1: { scope, dir: '' } })]) {
      expect(() => defineApi({ a: { contract: c, path: '/a', scopes } } as never)).toThrow(
        new TypeError('[@laratype/contract] defineApi: "a" scopes must be [{ scope, dir }], outer to inner'),
      )
    }
    expect(() => defineApi({ a: { contract: c, path: '/a', scopes: [{ scope, dir: '/a' }] } })).toThrow(/"a" scope dirs must be root-relative folders/)
    expect(() => defineApi({ a: { contract: c, path: '/a', scopes: [{ scope }] } } as never)).toThrow(/"a" scope dirs must be root-relative folders/)
    expect(() => defineApi({ a: { contract: c, path: '/a', scopes: [{ scope, dir: '' }, { scope, dir: '' }] } })).toThrow('[@laratype/contract] defineApi: "a" scope dirs must not repeat a folder ("")')
    expect(() => defineApi({ a: { contract: c, path: '/a', scopes: [{ scope, dir: 1 }] } } as never)).toThrow(/"a" scope dirs must be root-relative folders/)
    expect(defineApi({ a: { contract: c, path: '/a', scopes: [{ scope, dir: '' }] } }).a[API_NODE].entry.scopes).toEqual([{ scope, dir: '' }])
  })

  it('brands the root: isApiRoot, isApiNode and isContract tell the root, its nodes and contracts apart (C10 #258)', () => {
    expect(isApiRoot(appApi)).toBe(true)
    expect((appApi as Record<symbol, unknown>)[API_ROOT]).toBe(true)
    expect(Object.getOwnPropertySymbols(appApi)).toEqual([API_ROOT])
    expect(Object.keys(appApi)).toEqual(['users'])
    expect(isApiRoot(defineApi({}))).toBe(true)
    expect(isApiNode(appApi)).toBe(false)
    expect(isApiNode(appApi.users)).toBe(true)
    expect(isApiNode(appApi.users.posts)).toBe(true)
    expect(isContract(users)).toBe(true)
    // hand-made objects are not the root, whatever they hold
    for (const fake of [{}, { users: appApi.users }, { ...appApi }, users, appApi.users]) expect(isApiRoot(fake)).toBe(false)
    for (const value of [null, undefined, 1, 'users', users, users.show, { [API_NODE]: null }]) {
      expect(isApiRoot(value)).toBe(false)
      expect(isApiNode(value)).toBe(false)
    }
  })

  it('apiPaths and apiRoutes take the root, a node or a contract only (C10 #258)', () => {
    const forged = { [API_NODE]: { name: 'x' }, show: users.show }
    expect(() => apiPaths(forged as never)).toThrow(new TypeError('[@laratype/contract] apiPaths: expected the appApi from defineApi, an API node or a contract'))
    // a node's routes share one frozen scope list, taken from its { scope, dir } chain
    const [index, store] = apiRoutes(appApi.users.posts)
    expect(index!.scopes).toEqual([usersUser])
    expect(Object.isFrozen(index!.scopes)).toBe(true)
    expect(store!.scopes).toBe(index!.scopes)
    for (const fake of [{}, { users: appApi.users }, users.show, null]) {
      expect(() => apiEndpoint(fake as never, 'users.show' as never)).toThrow(new TypeError('[@laratype/contract] apiEndpoint: expected the appApi from defineApi or an API node'))
      expect(() => apiPaths(fake as never)).toThrow(new TypeError('[@laratype/contract] apiPaths: expected the appApi from defineApi, an API node or a contract'))
      expect(() => apiRoutes(fake as never)).toThrow(new TypeError('[@laratype/contract] apiRoutes: expected the appApi from defineApi, an API node or a contract'))
    }
  })

  it('re-checks the capability rules against the real scope chain', () => {
    const open = defineContract()({ stats: endpoint.get('/stats').public() })
    const authorize = defineScope()({ auth: true, authorize: true })
    expect(() => defineApi({ x: { contract: open, path: '/x', scopes: [{ scope: authorize, dir: '' }] } })).toThrow(
      /x.stats: .public\(\) under a scope with authorize: add .authorize\(false\)/,
    )
    expect(() => defineApi({ x: { contract: defineContract()({ d: endpoint.delete('/').authorize() }), path: '/x', scopes: [] } })).toThrow(
      /x.d: .authorize\(\) needs auth on the endpoint, its contract or a scope/,
    )
    const bare = defineScope()({ authorize: true } as never)
    expect(() => defineApi({ x: { contract: open, path: '/x', scopes: [{ scope: bare, dir: '' }] } })).toThrow(/scope 0 has authorize but no auth/)
    const allowed = defineContract()({ stats: endpoint.get('/stats').public().authorize(false) })
    expect(() => defineApi({ x: { contract: allowed, path: '/x', scopes: [{ scope: authorize, dir: '' }] } })).not.toThrow()
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
    const api = defineApi({ things: { contract: c, path: '/api/things', scopes: [] } })
    expect(apiRoutes(api).map((r) => [r.path, r.errors.map((e) => e.code)])).toEqual([
      ['/api/things', []],
      ['/api/things/:id?', ['NOT_FOUND']],
    ])
  })
})

describe('joinPath', () => {
  it('appends the path to the prefix, always with a "/" between them', () => {
    expect(joinPath('/api', '/users')).toBe('/api/users')
    expect(joinPath('', '/users')).toBe('/users')
    expect(joinPath('/api', '/')).toBe('/api')
    expect(joinPath('', '')).toBe('/')
    // a path without its leading "/" (a manifest, a forged endpoint) must not extend the prefix or a host before it
    expect(joinPath('/api', 'users')).toBe('/api/users')
    expect(joinPath('', '.evil.com/x')).toBe('/.evil.com/x')
    // a prefix that already ends with "/" gets none added: "/" + "x" is "/x", not "//x"
    expect(joinPath('/', 'x')).toBe('/x')
    expect(joinPath('/api/', 'users')).toBe('/api/users')
    // nor makes "//x" from a prefix ending with "/"
    expect(joinPath('/', '/users')).toBe('/users')
    expect(joinPath('/api/', '/users')).toBe('/api/users')
    expect(joinPath('/api/', '/')).toBe('/api')
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

describe('endpointErrors and routeErrors', () => {
  it('return the errors resolveCapabilities would, and never throw', () => {
    const paths = apiPaths(appApi)
    for (const route of apiRoutes(appApi)) {
      expect(routeErrors(paths.find((p) => p.name === route.name)!)).toEqual(route.errors)
    }
    // a contract taken out of its folder: routeErrors resolves it with its own options and never throws
    const scoped = defineContract<UserPrefix>()({ destroy: endpoint.delete('/:post').authorize() })
    expect(() => apiRoutes(scoped)).toThrow(/needs auth/)
    expect(routeErrors(apiPaths(scoped)[0]!).map((e) => e.code)).toEqual(['NOT_FOUND', 'FORBIDDEN'])
    // .authorize() without auth (it would come from a scope): resolveCapabilities throws, endpointErrors doesn't
    const def = endpoint.delete('/:post').authorize().def
    const alone = { path: '', scopes: [], options: {} }
    expect(() => resolveCapabilities(def, alone, 'destroy')).toThrow(/needs auth/)
    expect(endpointErrors(def, alone).map((e) => e.code)).toEqual(['NOT_FOUND', 'FORBIDDEN'])
  })
})

describe('throws', () => {
  it('rejects an error def whose status is outside 400-599 (an older copy or a hand-built def)', () => {
    const handBuilt = Object.assign(() => undefined, { code: 'OLD', status: 302, is: () => false })
    expect(() => endpoint.get('/').throws(handBuilt as never)).toThrow(/throws must be a list of errors \(use defineError\)/)
    expect(() => defineContract()({}, { throws: [handBuilt as never] })).toThrow(/throws must be a list of errors/)
    expect(endpoint.get('/').throws(errors.notFound).def.throws).toEqual([errors.notFound])
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
    const api = defineApi({ things: { contract: c, path: '/api/things', scopes: [] } })
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
    const api = defineApi({ health: { contract: defineContract()({ check: endpoint.get('/').response(z.object({ ok: z.boolean() })) }), path: '/health', scopes: [] } })
    expect(apiEndpoint(api, 'health.check').def.status).toBe(200)
    expect(defineError(409, 'X').code).toBe('X')
  })
})
