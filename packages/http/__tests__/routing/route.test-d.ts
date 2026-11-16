// Type tests for route() and redirect().route() (H13 #162): run by `bunx vitest run --project types`.
// The 0.5 http sources need the runtime globals and the HonoRequest overload that the build includes.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from 'vitest'
import { z } from 'zod'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Route, redirect, route } from '../../src/index'
import type { MountedRoute, Response, RouteKeyed, RouteName, RouteParamValue, RouteParamsOf } from '../../src/index'

const users = defineContract()({
  index: endpoint.get('/').query(z.object({ page: z.number().optional() })),
  show: endpoint.get('/:user'),
})
const posts = defineContract()({ update: endpoint.put('/:post') })
const appApi = defineApi({
  users: { contract: users, path: '/api/users', scopes: [] },
  'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [] },
})

class UsersController extends Controller {
  index() {}
  show() {}
}
class PostsController extends Controller {
  update() {}
}

/** The routes the app mounts; `Register` below types route() with them, as the app's `declare module` block does. */
const routes = Route.api(appApi, (r) => [
  r.contract(users, UsersController),
  r.contract(posts, PostsController),
  r.get('/ping', () => 'ok'),
  r.get('/health', () => 'ok').name('health'),
  r.get('/files/:name?', () => 'ok').name('file'),
])

declare module '@laratype/http' {
  interface Register {
    routes: typeof routes
  }
}

/** A model: its class carries the bindable statics, and the instance its route key (H14 #163). */
class User {
  static readonly primaryKey = 'id'
  static readonly routeKeyName = 'slug'
  declare readonly id: number
  declare readonly slug: string
  getRouteKey(): string {
    return this.slug
  }
}

describe('route() names', () => {
  test('contract names come from the tree, ad-hoc names from .name()', () => {
    expectTypeOf<RouteName>().toEqualTypeOf<'users.index' | 'users.show' | 'users.posts.update' | 'health' | 'file'>()
  })

  test('an unknown name is a type error', () => {
    // @ts-expect-error not a route of the tree
    route('users.nope')
    // @ts-expect-error a tree node, not a route
    route('users.posts')
    // @ts-expect-error an ad-hoc route without .name() is not addressable
    route('ping')
  })
})

describe('route() params', () => {
  test('come from the full path, folder params included', () => {
    expectTypeOf(route('users.posts.update', { user: 1, post: 2 })).toEqualTypeOf<string>()
    expectTypeOf(route('users.show', { user: 'ada' })).toEqualTypeOf<string>()
    expectTypeOf(route('users.index')).toEqualTypeOf<string>()
    // an optional ad-hoc param may be left out
    expectTypeOf(route('file')).toEqualTypeOf<string>()
    expectTypeOf(route('file', { name: 'readme' })).toEqualTypeOf<string>()
  })

  test('a required param is required and unknown ones are errors', () => {
    // @ts-expect-error users.show needs its user param
    route('users.show')
    // @ts-expect-error the folder param user is required too
    route('users.posts.update', { post: 2 })
    // @ts-expect-error not a param of the path
    route('users.show', { user: 1, slug: 'x' })
    // @ts-expect-error a param takes a string, a number, a bigint or a model
    route('users.show', { user: true })
  })

  test('a param accepts a model through RouteKeyed', () => {
    expectTypeOf<User>().toExtend<RouteKeyed>()
    expectTypeOf(route('users.show', { user: new User() })).toEqualTypeOf<string>()
    expectTypeOf(route('users.posts.update', { user: new User(), post: new User() })).toEqualTypeOf<string>()
  })

  test('a param accepts a bigint, directly and from getRouteKey() (DB1 #145)', () => {
    expectTypeOf<bigint>().toExtend<RouteParamValue>()
    expectTypeOf(route('users.posts.update', { user: 9007199254740993n, post: 2 })).toEqualTypeOf<string>()
    class BigId {
      getRouteKey(): bigint {
        return 1n
      }
    }
    expectTypeOf<BigId>().toExtend<RouteKeyed>()
    expectTypeOf(route('users.show', { user: new BigId() })).toEqualTypeOf<string>()
  })
})

describe('route() query and options', () => {
  test('query is the endpoint query schema input', () => {
    expectTypeOf(route('users.index', {}, { query: { page: 2 } })).toEqualTypeOf<string>()
    expectTypeOf(route('users.index', undefined, { query: {} })).toEqualTypeOf<string>()
    // @ts-expect-error the schema has no search
    route('users.index', {}, { query: { search: 'x' } })
    // @ts-expect-error page is a number in the schema input
    route('users.index', {}, { query: { page: '2' } })
    // @ts-expect-error users.show has no query schema
    route('users.show', { user: 1 }, { query: { page: 1 } })
  })

  test('absolute is a boolean option', () => {
    expectTypeOf(route('users.show', { user: 1 }, { absolute: true })).toEqualTypeOf<string>()
    // @ts-expect-error a boolean, not a string
    route('users.show', { user: 1 }, { absolute: 'yes' })
    // @ts-expect-error not an option
    route('users.show', { user: 1 }, { relative: true })
  })

  test('without a registration, any name and generic params', () => {
    expectTypeOf<RouteName<Record<string, never>>>().toEqualTypeOf<string>()
    expectTypeOf<RouteParamsOf<'whatever', Record<string, never>>>().toEqualTypeOf<
      Record<string, string | number | bigint | RouteKeyed>
    >()
  })
})

describe('.name()', () => {
  test('types the ad-hoc route and returns a new one', () => {
    Route.api(appApi, (r) => {
      const base = r.get('/health', () => 'ok')
      expectTypeOf(base).toEqualTypeOf<MountedRoute<'get', '/health', string>>()
      expectTypeOf(base.routeName).toEqualTypeOf<undefined>()
      const named = base.name('health')
      expectTypeOf(named).toEqualTypeOf<MountedRoute<'get', '/health', string, 'health'>>()
      expectTypeOf(named.routeName).toEqualTypeOf<'health'>()
      // @ts-expect-error a name is a string
      base.name(1)
      return [
        r.contract(users, UsersController),
        r.contract(posts, PostsController),
        named,
        r.get('/files/:name?', () => 'ok').name('file'),
      ]
    })
  })
})

describe('redirect().route()', () => {
  test('takes the same names and params', () => {
    expectTypeOf(redirect().route('users.show', { user: 1 })).toEqualTypeOf<Response>()
    expectTypeOf(redirect(301).route('file', { name: 'readme' }, { absolute: true })).toEqualTypeOf<Response>()
    // @ts-expect-error not a route of the tree
    redirect().route('users.nope')
    // @ts-expect-error users.show needs its user param
    redirect().route('users.show')
  })
})
