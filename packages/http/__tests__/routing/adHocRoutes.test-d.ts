// Type tests for ad-hoc routes (H12 #139): run by `bunx vitest run --project types`.
// The 0.5 http sources need the runtime globals and the HonoRequest overload that the build includes.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from 'vitest'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Middleware, Route } from '../../src/index'
import type { AdHocRouteEntry, MountedRoute, Request, RouteEntry } from '../../src/index'
import type { Hono } from 'hono'

const users = defineContract()({ index: endpoint.get('/') })
const appApi = defineApi({ users: { contract: users, path: '/api/users', scopes: [] } })

class UserController extends Controller { index() {} }
class Audit extends Middleware {}

describe('r.get() and the other methods', () => {
  test('infer the method, the path and the result', () => {
    Route.api(appApi, (r) => {
      const health = r.get('/health', () => 'ok')
      expectTypeOf(health).toEqualTypeOf<MountedRoute<'get', '/health', string>>()
      const created = r.middleware(Audit).post('/items', async () => ({ created: true }))
      expectTypeOf(created).toEqualTypeOf<MountedRoute<'post', '/items', { created: boolean }>>()
      expectTypeOf(r.put('/a', () => 1)).toEqualTypeOf<MountedRoute<'put', '/a', number>>()
      expectTypeOf(r.patch('/a', () => 1)).toEqualTypeOf<MountedRoute<'patch', '/a', number>>()
      expectTypeOf(r.delete('/a', () => 1)).toEqualTypeOf<MountedRoute<'delete', '/a', number>>()
      return [r.contract(users, UserController), health, created]
    })
  })

  test('the handler gets the request and the params of its path', () => {
    Route.api(appApi, (r) => [
      r.contract(users, UserController),
      r.get('/users/:user/posts/:post?', (req, params) => {
        expectTypeOf(req).toEqualTypeOf<Request>()
        expectTypeOf(params).toEqualTypeOf<{ user: string; post?: string }>()
      }),
      r.get('/posts/:id{[0-9]+}', (req, params) => {
        expectTypeOf(params).toEqualTypeOf<{ id: string }>()
        // @ts-expect-error not a param of the path
        params.slug
      }),
      r.get('/health', (req, params) => expectTypeOf(params).toEqualTypeOf<{}>()),
    ])
  })

  test('the path starts with "/"', () => {
    Route.api(appApi, (r) => [
      r.contract(users, UserController),
      // @ts-expect-error a relative path
      r.get('health', () => 'ok'),
    ])
  })

  test('the route check still needs every contract', () => {
    // @ts-expect-error contract "users" is not mounted
    Route.api(appApi, (r) => [r.get('/health', () => 'ok')])
  })

  test('mount() returns the contract and the ad-hoc entries', () => {
    const routes = Route.api(appApi, (r) => [r.contract(users, UserController), r.get('/health', () => 'ok')])
    expectTypeOf(routes.routes).toEqualTypeOf<readonly RouteEntry[]>()
    expectTypeOf(routes.adHoc).toEqualTypeOf<readonly AdHocRouteEntry[]>()
    expectTypeOf(routes.mount({} as Hono)).toEqualTypeOf<(RouteEntry | AdHocRouteEntry)[]>()
  })
})
