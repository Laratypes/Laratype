// Type tests for Route.api (H1 #104): run by `bunx vitest run --project types`.
// The 0.5 http sources need the runtime globals and the HonoRequest overload that the build includes.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from 'vitest'
import { defineApi, defineContract, defineScope, endpoint } from '@laratype/contract'
import type { ContractPrefix } from '@laratype/contract'
import { Controller, Middleware, Route } from '../../src/index'
import type { ApiAuthorizeDir, ApiRoutes, ApiScopeDir, ApiTreeName, MountedContract, MountedScope } from '../../src/index'

const root = defineScope()({ auth: true })
const usersUser = defineScope<ContractPrefix<'/api/users/:user', [typeof root]>>()({ authorize: true })
const users = defineContract()({ index: endpoint.get('/'), show: endpoint.get('/:id') })
const posts = defineContract()({ index: endpoint.get('/'), store: endpoint.post('/') })
const health = defineContract()({ check: endpoint.get('/') })
const appApi = defineApi({
  users: { contract: users, path: '/api/users', scopes: [root], dirs: [''] },
  'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [root, usersUser], dirs: ['', 'users/[user]'] },
  'v1.health': { contract: health, path: '/api/v1/health', scopes: [], dirs: [] },
})

class UserController extends Controller { index() { return [] } show() { return {} } }
class PostController extends Controller { index() { return [] } store() { return {} } }
class HealthController extends Controller { check() { return { ok: true } } }
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

  test('two contracts with identical types: compile-time checks skip them, the runtime check covers them', () => {
    const a = defineContract()({ index: endpoint.get('/') })
    const b = defineContract()({ index: endpoint.get('/') })
    const twins = defineApi({
      a: { contract: a, path: '/a', scopes: [], dirs: [] },
      b: { contract: b, path: '/b', scopes: [], dirs: [] },
    })
    class Ctrl extends Controller { index() { return [] } }
    // both mounted: no false duplicate
    Route.api(twins, (r) => [r.contract(a, Ctrl), r.contract(b, Ctrl)])
    // only one mounted: not caught at compile time (Route.api throws at runtime)
    Route.api(twins, (r) => [r.contract(a, Ctrl)])
  })
})
