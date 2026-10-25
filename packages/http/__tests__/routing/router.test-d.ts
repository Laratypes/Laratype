// Type tests for Route.api (H1 #104): run by `bunx vitest run --project types`.
// The 0.5 http sources need the runtime globals and the HonoRequest overload that the build includes.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from 'vitest'
import { defineApi, defineContract, defineScope, endpoint } from '@laratype/contract'
import type { ContractPrefix } from '@laratype/contract'
import { Controller, Middleware, Route } from '../../src/index'
import type { ApiAuthorizeDir, ApiRoutes, ApiScopeDir, ApiTreeName, CheckApiRoutes, Ctx, EndpointKey, EndpointRouteBuilder, MountedContract, MountedScope } from '../../src/index'

const root = defineScope()({ auth: true })
const usersUser = defineScope<ContractPrefix<'/api/users/:user', [typeof root]>>()({ authorize: true })
const users = defineContract()({ index: endpoint.get('/'), show: endpoint.get('/:id') })
const posts = defineContract()({ index: endpoint.get('/'), store: endpoint.post('/') })
const health = defineContract()({ check: endpoint.get('/') })
const appApi = defineApi({
  users: { contract: users, path: '/api/users', scopes: [{ scope: root, dir: '' }] },
  'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [{ scope: root, dir: '' }, { scope: usersUser, dir: 'users/[user]' }] },
  'v1.health': { contract: health, path: '/api/v1/health', scopes: [] },
})

// The endpoints declare no response schema, so the handlers return nothing (the route proof checks it)
class UserController extends Controller { index() {} show() {} }
class PostController extends Controller { index() {} store() {} }
class HealthController extends Controller { check() {} }
class UserScopePolicy {}
class Audit extends Middleware {}

describe('reading the tree', () => {
  test('tree names and scope folders', () => {
    expectTypeOf<ApiTreeName<typeof appApi>>().toEqualTypeOf<'users' | 'users.posts' | 'v1.health'>()
    expectTypeOf<ApiScopeDir<typeof appApi>>().toEqualTypeOf<'' | 'users/[user]'>()
    expectTypeOf<ApiAuthorizeDir<typeof appApi>>().toEqualTypeOf<'users/[user]'>()
  })
})

describe('Route.api', () => {
  test('takes the root that defineApi returns only, told by its brand (C10 #258)', () => {
    // @ts-expect-error a hand-made object of the root's own nodes
    Route.api({ users: appApi.users }, () => [])
    // @ts-expect-error an API node
    Route.api(appApi.users, () => [])
  })

  test('every contract once, and a policy on the authorize scope', () => {
    const routes = Route.api(appApi, (r) => [
      r.contract(users, UserController),
      r.middleware(Audit).scope('users/[user]', { policy: UserScopePolicy }),
      r.contract(posts, PostController),
      r.contract(health, HealthController),
    ])
    expectTypeOf(routes).toEqualTypeOf<ApiRoutes>()
    expectTypeOf(routes.domain('api.example.test')).toEqualTypeOf<ApiRoutes>()
  })

  test('r.contract() and r.scope() return typed items', () => {
    Route.api(appApi, (r) => {
      expectTypeOf(r.contract(users, UserController)).toEqualTypeOf<MountedContract<typeof users>>()
      expectTypeOf(r.scope('users/[user]', { policy: UserScopePolicy })).toEqualTypeOf<MountedScope<'users/[user]'>>()
      return [] as never
    })
  })

  test('a missing contract is an error', () => {
    // @ts-expect-error Route.api: contract "v1.health" is not mounted (add r.contract())
    Route.api(appApi, (r) => [
      r.contract(users, UserController),
      r.scope('users/[user]', { policy: UserScopePolicy }),
      r.contract(posts, PostController),
    ])
  })

  test('a duplicate contract is an error', () => {
    // @ts-expect-error Route.api: contract "users" is mounted twice
    Route.api(appApi, (r) => [
      r.contract(users, UserController),
      r.scope('users/[user]', { policy: UserScopePolicy }),
      r.contract(posts, PostController),
      r.contract(health, HealthController),
      r.contract(users, UserController),
    ])
  })

  test('an authorize scope without a policy is an error', () => {
    // @ts-expect-error Route.api: scope "users/[user]" has authorize but no policy (add r.scope() with { policy })
    Route.api(appApi, (r) => [
      r.contract(users, UserController),
      r.contract(posts, PostController),
      r.contract(health, HealthController),
    ])
  })

  test('a scope mounted twice is an error', () => {
    // @ts-expect-error Route.api: scope "users/[user]" is mounted twice
    Route.api(appApi, (r) => [
      r.contract(users, UserController),
      r.scope('users/[user]', { policy: UserScopePolicy }),
      r.scope('users/[user]', { policy: UserScopePolicy }),
      r.contract(posts, PostController),
      r.contract(health, HealthController),
    ])
  })

  test('a contract or a folder outside the tree is an error at the argument', () => {
    const other = defineContract()({ list: endpoint.get('/list') })
    Route.api(appApi, (r) => [
      // @ts-expect-error not a contract of the tree
      r.contract(other, UserController),
      // @ts-expect-error not a scope folder of the tree
      r.scope('users', { policy: UserScopePolicy }),
    ] as never)
  })

  test('r.scope() needs a policy', () => {
    Route.api(appApi, (r) => [
      // @ts-expect-error { policy } is required
      r.scope('users/[user]', {}),
    ] as never)
  })

  test('a tree node mounts its contract', () => {
    Route.api(appApi, (r) => [
      r.contract(appApi.users, UserController),
      r.scope('users/[user]', { policy: UserScopePolicy }),
      r.contract(appApi.users.posts, PostController),
      r.contract(health, HealthController),
    ])
    // @ts-expect-error Route.api: contract "users" is mounted twice
    Route.api(appApi, (r) => [
      r.contract(appApi.users, UserController),
      r.scope('users/[user]', { policy: UserScopePolicy }),
      r.contract(posts, PostController),
      r.contract(health, HealthController),
      r.contract(users, UserController),
    ])
    Route.api(appApi, (r) => [
      // @ts-expect-error a folder node without a contract is not mountable
      r.contract(appApi.v1, HealthController),
    ] as never)
  })

  test('two contracts with the same type in one folder: the contract alone is an error, the tree node tells them apart', () => {
    // app/api/posts.ts and app/api/comments.ts, both `{ index: endpoint.get('/').response(Dto) }` with the same Prefix
    type Prefix = ContractPrefix<'/api', []>
    const dto = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const
    const postsOnly = defineContract<Prefix>()({ index: endpoint.get('/').response(dto) })
    const comments = defineContract<Prefix>()({ index: endpoint.get('/').response(dto) })
    const twins = defineApi({
      posts: { contract: postsOnly, path: '/api/posts', scopes: [] },
      comments: { contract: comments, path: '/api/comments', scopes: [] },
    })
    class Ctrl extends Controller { index() { return [] } }
    // @ts-expect-error Route.api: contract "posts" | "comments" has the type of another contract of the tree
    Route.api(twins, (r) => [r.contract(postsOnly, Ctrl)])
    // @ts-expect-error both mounted by value: still ambiguous at compile time
    Route.api(twins, (r) => [r.contract(postsOnly, Ctrl), r.contract(comments, Ctrl)])
    Route.api(twins, (r) => [r.contract(twins.posts, Ctrl), r.contract(twins.comments, Ctrl)])
    // @ts-expect-error Route.api: contract "comments" is not mounted (add r.contract())
    Route.api(twins, (r) => [r.contract(twins.posts, Ctrl)])
    // @ts-expect-error Route.api: contract "posts" is mounted twice
    Route.api(twins, (r) => [r.contract(twins.posts, Ctrl), r.contract(twins.comments, Ctrl), r.contract(twins.posts, Ctrl)])
  })

  test('the error names the problem', () => {
    const a = defineContract()({ index: endpoint.get('/') })
    const b = defineContract()({ index: endpoint.get('/') })
    const twins = defineApi({ a: { contract: a, path: '/a', scopes: [] }, b: { contract: b, path: '/b', scopes: [] } })
    type Items = [MountedContract<typeof a>]
    expectTypeOf<CheckApiRoutes<typeof twins, Items>>().toEqualTypeOf<{
      error:
        | 'Route.api: contract "a" has the type of another contract of the tree: mount it with its tree node, r.contract(appApi.<name>, ...)'
        | 'Route.api: contract "b" has the type of another contract of the tree: mount it with its tree node, r.contract(appApi.<name>, ...)'
    }>()
    type ByNode = [MountedContract<typeof twins.a>]
    expectTypeOf<CheckApiRoutes<typeof twins, ByNode>>().toEqualTypeOf<{ error: 'Route.api: contract "b" is not mounted (add r.contract())' }>()
  })
})

describe('r.contract() options and ctx.endpoint (H2a #105)', () => {
  class PostPolicy {}

  test('ctx.endpoint is the endpoint, read-only', () => {
    const ctx = {} as Ctx<typeof users.show>
    expectTypeOf(ctx.endpoint).toEqualTypeOf<typeof users.show>()
    // @ts-expect-error endpoint is read-only
    ctx.endpoint = users.show
  })

  test('endpoints are keyed by the endpoints of the contract or its tree node', () => {
    expectTypeOf<EndpointKey<typeof users>>().toEqualTypeOf<'index' | 'show'>()
    expectTypeOf<EndpointKey<typeof appApi.users>>().toEqualTypeOf<'index' | 'show'>()
    Route.api(appApi, (r) => [
      r.contract(users, UserController, { policy: PostPolicy, endpoints: { show: (r) => r.middleware(Audit) } }),
      r.scope('users/[user]', { policy: UserScopePolicy }),
      r.contract(appApi.users.posts, PostController, { endpoints: { store: (r) => r.middleware(Audit).middleware(Audit) } }),
      r.contract(health, HealthController, {}),
    ])
  })

  test('endpoints named after Object.prototype members take an inline map, with or without them', () => {
    const odd = defineContract()({
      toString: endpoint.get('/t'), valueOf: endpoint.get('/v'), hasOwnProperty: endpoint.get('/h'), isPrototypeOf: endpoint.get('/i'),
      propertyIsEnumerable: endpoint.get('/p'), toLocaleString: endpoint.get('/l'), constructor: endpoint.get('/c'), index: endpoint.get('/'),
    })
    const oddApi = defineApi({ odd: { contract: odd, path: '/odd', scopes: [], dirs: [] } })
    class OddController extends Controller {
      toString() {} valueOf() {} hasOwnProperty() {} isPrototypeOf() {} propertyIsEnumerable() {} toLocaleString() {} index() {}
    }
    const audit = (r: EndpointRouteBuilder) => r.middleware(Audit)
    Route.api(oddApi, (r) => [r.contract(odd, OddController as never, { endpoints: { index: (r) => r.middleware(Audit) } })])
    Route.api(oddApi, (r) => [r.contract(odd, OddController as never, { endpoints: { index: audit } })])
    // `r` keeps its contextual type on every colliding key
    Route.api(oddApi, (r) => [r.contract(odd, OddController as never, {
      endpoints: {
        toString: (r) => r.middleware(Audit), valueOf: (r) => r.middleware(Audit), hasOwnProperty: (r) => r.middleware(Audit),
        isPrototypeOf: (r) => r.middleware(Audit), propertyIsEnumerable: (r) => r.middleware(Audit),
        toLocaleString: (r) => r.middleware(Audit), constructor: (r) => r.middleware(Audit),
      },
    })])
    Route.api(oddApi, (r) => [
      // @ts-expect-error the callback of a non-colliding key still returns the builder
      r.contract(odd, OddController as never, { endpoints: { index: () => [Audit] } }),
      // @ts-expect-error so does the callback of a colliding key whose Object.prototype member takes no parameter
      r.contract(odd, OddController as never, { endpoints: { toString: () => [Audit] } }),
      // @ts-expect-error a middleware class is not a callback
      r.contract(odd, OddController as never, { endpoints: { valueOf: Audit } }),
    ] as never)
  })

  test('an unknown endpoint, a callback that does not return the builder, or a policy that is not a class is an error', () => {
    Route.api(appApi, (r) => [
      // @ts-expect-error destroy is not an endpoint of users
      r.contract(users, UserController, { endpoints: { destroy: (r) => r.middleware(Audit) } }),
      // @ts-expect-error the callback returns the builder
      r.contract(posts, PostController, { endpoints: { index: () => [Audit] } }),
      // @ts-expect-error policy is a class
      r.contract(health, HealthController, { policy: 'HealthPolicy' }),
    ] as never)
  })
})
