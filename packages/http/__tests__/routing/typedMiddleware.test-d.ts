// Type tests for typed middleware with context extension (H6 #117): run by `bunx vitest run --project types`.
// The 0.5 http sources need the runtime globals and the HonoRequest overload that the build includes.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from 'vitest'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Middleware, Route, defineMiddleware } from '../../src/index'
import type { AnyTypedMiddleware, ApiRouteBuilder, ControllerOf, Ctx, MiddlewareHandler, MiddlewareItem, RouteProof, TypedMiddleware } from '../../src/index'

const posts = defineContract()({ index: endpoint.get('/'), destroy: endpoint.delete('/:post') })
const appApi = defineApi({ posts: { contract: posts, path: '/api/posts', scopes: [] } })

class User {
  declare readonly id: number
}

const auth = defineMiddleware<{ user: User }>((request, next) => next({ user: new User() }))
const audit = defineMiddleware((request, next) => next())

class Audit extends Middleware {}

class Plain extends Controller {
  index() {}
  destroy() {}
}

describe('defineMiddleware', () => {
  test('declares the context keys it adds', () => {
    expectTypeOf(auth).toEqualTypeOf<TypedMiddleware<{ user: User }>>()
    expectTypeOf(audit).toEqualTypeOf<TypedMiddleware<{}>>()
  })

  test('next() takes the declared keys, and checks them', () => {
    defineMiddleware<{ user: User }>((request, next) => next({ user: new User() }))
    // a declared key the middleware does not pass is not an error: `next()` may also short-circuit
    defineMiddleware<{ user: User }>((request, next) => next())
    // @ts-expect-error `user` must be a User
    defineMiddleware<{ user: User }>((request, next) => next({ user: 'ada' }))
    // @ts-expect-error `user` is not a key this middleware adds
    defineMiddleware<{ user: User }>((request, next) => next({ admin: true }))
  })

  test('the exported handler types describe the middleware and the keys it adds', () => {
    expectTypeOf<Parameters<MiddlewareHandler<{ user: User }>>[1]>().toEqualTypeOf<(ext?: { user: User }) => Promise<unknown>>()
    expectTypeOf<AnyTypedMiddleware>().toEqualTypeOf<TypedMiddleware<any>>()
    const item: MiddlewareItem = auth
    expectTypeOf(item).toMatchTypeOf<MiddlewareItem>()
  })

  test('`r.middleware()` takes 0.5 classes and typed middleware', () => {
    expectTypeOf<MiddlewareItem>().toEqualTypeOf<typeof Middleware | TypedMiddleware<any>>()
    Route.api(appApi, (r) => [r.middleware(Audit, auth, audit).contract(posts, Plain)])
    Route.api(appApi, (r) => [
      // @ts-expect-error not middleware
      r.middleware(42).contract(posts, Plain),
    ])
  })
})

describe('the handler sees the accumulated context', () => {
  test('route middleware extends every handler of the contract it is mounted for', () => {
    class NeedsUser extends Controller {
      index(ctx: Ctx<typeof posts.index, { user: User }>) { void ctx.user }
      destroy(ctx: Ctx<typeof posts.destroy, { user: User }>) { void ctx.user }
    }
    Route.api(appApi, (r) => [r.middleware(auth).contract(posts, NeedsUser)])
    expectTypeOf<RouteProof<typeof appApi, typeof posts, NeedsUser, { policy: undefined }, { user: User }>>().toEqualTypeOf<unknown>()
  })

  test('middleware mounted at several levels accumulates in order', () => {
    class NeedsBoth extends Controller {
      index(ctx: Ctx<typeof posts.index, { user: User; audited: true }>) { void [ctx.user, ctx.audited] }
      destroy() {}
    }
    const audited = defineMiddleware<{ audited: true }>((request, next) => next({ audited: true }))
    Route.api(appApi, (r) => [r.middleware(auth).middleware(audited).contract(posts, NeedsBoth)])
  })

  test('the endpoint callbacks take 0.5 classes: typed middleware is a route-level feature', () => {
    Route.api(appApi, (r) => [r.contract(posts, Plain, { endpoints: { destroy: (r) => r.middleware(Audit).withoutMiddleware(Audit) } })])
    Route.api(appApi, (r) => [
      // @ts-expect-error a typed middleware does not join the ctx of one endpoint's handler
      r.contract(posts, Plain, { endpoints: { destroy: (r) => r.middleware(auth) } }),
    ])
  })
})

describe('withoutMiddleware', () => {
  test('drops what the builder accumulated', () => {
    expectTypeOf<ApiRouteBuilder<typeof appApi>>().toEqualTypeOf<ApiRouteBuilder<typeof appApi, []>>()
    Route.api(appApi, (r) => [r.middleware(auth).withoutMiddleware(auth).contract(posts, Plain)])
    Route.api(appApi, (r) => [r.middleware(Audit, auth).withoutMiddleware(Audit).withoutMiddleware(auth).contract(posts, Plain)])
  })

  test('the requirement it drops is reported at r.contract()', () => {
    class NeedsUser extends Controller {
      index(ctx: Ctx<typeof posts.index, { user: User }>) { void ctx.user }
      destroy() {}
    }
    // @ts-expect-error posts.index: handler requires `user`, route does not provide it (add middleware / .bind())
    Route.api(appApi, (r) => [r.middleware(auth).withoutMiddleware(auth).contract(posts, NeedsUser)])
  })
})

describe('a missing middleware is reported at r.contract()', () => {
  class NeedsUser extends Controller {
    index(ctx: Ctx<typeof posts.index, { user: User }>) { void ctx.user }
    destroy() {}
  }

  test('the proof names the endpoint and the missing key', () => {
    expectTypeOf<RouteProof<typeof appApi, typeof posts, NeedsUser, { policy: undefined }>>().toHaveProperty(
      'posts.index: handler requires `user`, route does not provide it (add middleware / .bind())',
    )
    // @ts-expect-error posts.index: handler requires `user`, route does not provide it (add middleware / .bind())
    Route.api(appApi, (r) => [r.contract(posts, NeedsUser)])
  })

  test('a controller typed with ControllerOf is still proven at r.contract()', () => {
    class Declared implements ControllerOf<typeof posts> {
      index(ctx: Ctx<typeof posts.index, { user: User }>) { void ctx.user }
      destroy() {}
    }
    // @ts-expect-error posts.index: handler requires `user`, route does not provide it (add middleware / .bind())
    Route.api(appApi, (r) => [r.contract(posts, Declared)])
  })
})
