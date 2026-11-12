// Type tests for typed middleware with context extension (H6 #117): run by `bunx vitest run --project types`.
// The 0.5 http sources need the runtime globals and the HonoRequest overload that the build includes.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from 'vitest'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Middleware, Route, defineMiddleware, isTypedMiddleware } from '../../src/index'
import type { AnyTypedMiddleware, ApiRouteBuilder, ControllerOf, Ctx, ExtOf, Merge, MiddlewareClass, MiddlewareHandler, MiddlewareItem, NextHandler, RouteProof, TypedMiddleware, TypedMiddlewareHandler } from '../../src/index'

const posts = defineContract()({ index: endpoint.get('/'), destroy: endpoint.delete('/:post') })
const appApi = defineApi({ posts: { contract: posts, path: '/api/posts', scopes: [] } })

class User {
  declare readonly id: number
}

/** A self-referencing extension value: the conflict walk must terminate on it (H6 #117, docs/v1/http.md › Typed middleware › Invariants). */
interface RecursiveNode {
  next: RecursiveNode
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
    // @ts-expect-error a required key makes the extension required: pass it, or do not call next() (short-circuit)
    defineMiddleware<{ user: User }>((request, next) => next())
    // @ts-expect-error `user` must be a User
    defineMiddleware<{ user: User }>((request, next) => next({ user: 'ada' }))
    // @ts-expect-error `user` is not a key this middleware adds
    defineMiddleware<{ user: User }>((request, next) => next({ admin: true }))
    // every key optional, or `{}`: next() stays optional
    defineMiddleware<{ user?: User }>((request, next) => next())
    defineMiddleware<{ user?: User }>((request, next) => next({ user: new User() }))
    defineMiddleware((request, next) => next())
    defineMiddleware<{}>((request, next) => next())
  })

  test('the exported handler types describe the middleware and the keys it adds', () => {
    expectTypeOf<Parameters<TypedMiddlewareHandler<{ user: User }>>[1]>().toEqualTypeOf<(ext: { user: User }) => Promise<unknown>>()
    expectTypeOf<Parameters<TypedMiddlewareHandler<{ user?: User }>>[1]>().toEqualTypeOf<(ext?: { user?: User }) => Promise<unknown>>()
    expectTypeOf<Parameters<TypedMiddlewareHandler>[1]>().toEqualTypeOf<(ext?: {}) => Promise<unknown>>()
    expectTypeOf<AnyTypedMiddleware>().toEqualTypeOf<TypedMiddleware<any>>()
  })

  test('isTypedMiddleware narrows a value to a typed middleware', () => {
    const value: unknown = auth
    if (isTypedMiddleware(value)) {
      expectTypeOf(value).toEqualTypeOf<TypedMiddleware<any>>()
    }
  })

  test('the 0.5 `MiddlewareHandler` keeps its `(request, res, next)` shape', () => {
    expectTypeOf<Parameters<MiddlewareHandler>['length']>().toEqualTypeOf<3>()
    expectTypeOf<Parameters<MiddlewareHandler>[2]>().toEqualTypeOf<NextHandler>()
    class AdminGuard extends Middleware {
      handle: MiddlewareHandler = async (request, res, next) => {
        void res.status
        return next(request)
      }
    }
    void AdminGuard
  })

  test('`r.middleware()` takes 0.5 classes and typed middleware', () => {
    expectTypeOf<MiddlewareItem>().toEqualTypeOf<MiddlewareClass | TypedMiddleware<any>>()
    Route.api(appApi, (r) => [r.middleware(Audit, auth, audit).contract(posts, Plain)])
    Route.api(appApi, (r) => [
      // @ts-expect-error not middleware
      r.middleware(42).contract(posts, Plain),
    ])
  })
})

describe('the handler sees the accumulated context', () => {
  test('Merge is the last-wins merge ExtOf uses', () => {
    expectTypeOf<Merge<{ a: string; params: { post: string } }, { a: number; params: { extra: number } }>>().toEqualTypeOf<{
      a: number
      params: { post: string; extra: number }
    }>()
  })

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

  test('a later middleware wins a key it also adds, as the runtime does', () => {
    const broad = defineMiddleware<{ user: { id: string; name: string } }>((request, next) => next({ user: { id: '1', name: 'ada' } }))
    const narrow = defineMiddleware<{ user: { id: string } }>((request, next) => next({ user: { id: '1' } }))
    expectTypeOf<ExtOf<[typeof broad, typeof narrow]>>().toEqualTypeOf<{ user: { id: string } }>()
    class NeedsName extends Controller {
      index(ctx: Ctx<typeof posts.index, { user: { id: string; name: string } }>) { void ctx.user.name }
      destroy() {}
    }
    expectTypeOf<RouteProof<typeof appApi, typeof posts, NeedsName, { policy: undefined }, ExtOf<[typeof broad, typeof narrow]>>>().toHaveProperty(
      'posts.index: `user` provided by the route does not match the handler (missing .bind()?)',
    )
    // @ts-expect-error posts.index: `user` provided by the route does not match the handler (missing .bind()?)
    Route.api(appApi, (r) => [r.middleware(broad, narrow).contract(posts, NeedsName)])
  })

  test('the proof checks the type of the value the runtime keeps', () => {
    const tagString = defineMiddleware<{ tag: string }>((request, next) => next({ tag: 'x' }))
    const tagNumber = defineMiddleware<{ tag: number }>((request, next) => next({ tag: 1 }))
    expectTypeOf<ExtOf<[typeof tagString, typeof tagNumber]>>().toEqualTypeOf<{ tag: number }>()
    class NeedsNumber extends Controller {
      index(ctx: Ctx<typeof posts.index, { tag: number }>) { void ctx.tag.toFixed() }
      destroy() {}
    }
    class NeedsString extends Controller {
      index(ctx: Ctx<typeof posts.index, { tag: string }>) { void ctx.tag.toUpperCase() }
      destroy() {}
    }
    Route.api(appApi, (r) => [r.middleware(tagString, tagNumber).contract(posts, NeedsNumber)])
    // @ts-expect-error posts.index: `tag` provided by the route does not match the handler (missing .bind()?)
    Route.api(appApi, (r) => [r.middleware(tagString, tagNumber).contract(posts, NeedsString)])
  })

  test('a nested key is last-wins too', () => {
    const deepString = defineMiddleware<{ a: { b: { c: { d: string } } } }>((request, next) => next({ a: { b: { c: { d: 'x' } } } }))
    const deepNumber = defineMiddleware<{ a: { b: { c: { d: number } } } }>((request, next) => next({ a: { b: { c: { d: 1 } } } }))
    expectTypeOf<ExtOf<[typeof deepString, typeof deepNumber]>>().toEqualTypeOf<{ a: { b: { c: { d: number } } } }>()
    class NeedsDeep extends Controller {
      index(ctx: Ctx<typeof posts.index, { a: { b: { c: { d: string } } } }>) { void ctx.a.b.c.d.toUpperCase() }
      destroy() {}
    }
    // @ts-expect-error posts.index: `a` provided by the route does not match the handler (missing .bind()?)
    Route.api(appApi, (r) => [r.middleware(deepString, deepNumber).contract(posts, NeedsDeep)])
  })

  test('a self-referencing extension type is walked once per path', () => {
    const tree = defineMiddleware<{ node: RecursiveNode }>((request, next) => next({ node: { next: null as unknown as RecursiveNode } }))
    class ReadsTree extends Controller {
      index(ctx: Ctx<typeof posts.index, { node: RecursiveNode }>) { void ctx.node.next }
      destroy() {}
    }
    expectTypeOf<RouteProof<typeof appApi, typeof posts, ReadsTree, { policy: undefined }, ExtOf<[typeof tree]>>>().toEqualTypeOf<unknown>()
    Route.api(appApi, (r) => [r.middleware(tree).contract(posts, ReadsTree)])
  })

  test('a function-valued key is compared through the later middleware value', () => {
    const fnString = defineMiddleware<{ fn: (value: string) => string }>((request, next) => next({ fn: (value) => value }))
    const fnNumber = defineMiddleware<{ fn: (value: number) => number }>((request, next) => next({ fn: (value) => value }))
    expectTypeOf<ExtOf<[typeof fnString, typeof fnNumber]>>().toEqualTypeOf<{ fn: (value: number) => number }>()
    class NeedsFn extends Controller {
      index(ctx: Ctx<typeof posts.index, { fn: (value: number) => number }>) { void ctx.fn(1).toFixed() }
      destroy() {}
    }
    Route.api(appApi, (r) => [r.middleware(fnString, fnNumber).contract(posts, NeedsFn)])
  })

  test('a middleware that declares a key `never` gets the diagnosis', () => {
    const neverTag = defineMiddleware<{ tag: never }>((request, next) => next({ tag: undefined as never }))
    expectTypeOf<RouteProof<typeof appApi, typeof posts, Plain, { policy: undefined }, ExtOf<[typeof neverTag]>>>().toHaveProperty(
      "posts.index: middleware extension 'tag' is `never` (declared `never`)",
    )
    // @ts-expect-error posts.index: middleware extension 'tag' is `never` (declared `never`)
    Route.api(appApi, (r) => [r.middleware(neverTag).contract(posts, Plain)])
  })

  test('a nested `never` is named by its path', () => {
    const neverUser = defineMiddleware<{ user: { id: never } }>((request, next) => next({ user: { id: undefined as never } }))
    expectTypeOf<RouteProof<typeof appApi, typeof posts, Plain, { policy: undefined }, ExtOf<[typeof neverUser]>>>().toHaveProperty(
      "posts.index: middleware extension 'user.id' is `never` (declared `never`)",
    )
  })

  test('a key typed only `undefined` is not a conflict', () => {
    const slot = defineMiddleware<{ previousUser: undefined }>((request, next) => next({ previousUser: undefined }))
    class ReadsSlot extends Controller {
      index(ctx: Ctx<typeof posts.index, { previousUser: undefined }>) { void ctx.previousUser }
      destroy() {}
    }
    expectTypeOf<RouteProof<typeof appApi, typeof posts, ReadsSlot, { policy: undefined }, ExtOf<[typeof slot]>>>().toEqualTypeOf<unknown>()
    Route.api(appApi, (r) => [r.middleware(slot).contract(posts, ReadsSlot)])
  })

  test('`params` is merged one level deep, as the runtime merges it', () => {
    const postString = defineMiddleware<{ params: { post: string } }>((request, next) => next({ params: { post: 'x' } }))
    const extra = defineMiddleware<{ params: { extra: number } }>((request, next) => next({ params: { extra: 1 } }))
    expectTypeOf<ExtOf<[typeof postString, typeof extra]>>().toEqualTypeOf<{ params: { post: string; extra: number } }>()
    const postNumber = defineMiddleware<{ params: { post: number } }>((request, next) => next({ params: { post: 1 } }))
    expectTypeOf<ExtOf<[typeof postString, typeof postNumber]>>().toEqualTypeOf<{ params: { post: number } }>()
    class NeedsPost extends Controller {
      index() {}
      destroy(ctx: Ctx<typeof posts.destroy, { params: { post: string } }>) { void ctx.params.post.toUpperCase() }
    }
    // @ts-expect-error posts.destroy: `params.post` provided by the route does not match the handler (missing .bind()?)
    Route.api(appApi, (r) => [r.middleware(postString, postNumber).contract(posts, NeedsPost)])
  })

  test('a middleware extension cannot replace a key the contract route keeps', () => {
    const queryOverride = defineMiddleware<{ query: { page: string } }>((request, next) => next({ query: { page: '1' } }))
    expectTypeOf<RouteProof<typeof appApi, typeof posts, Plain, { policy: undefined }, ExtOf<[typeof queryOverride]>>>().toHaveProperty(
      "posts.index: middleware extension 'query' is reserved (a contract route keeps its own query, body and endpoint)",
    )
    // @ts-expect-error posts.index: middleware extension 'query' is reserved
    Route.api(appApi, (r) => [r.middleware(queryOverride).contract(posts, Plain)])
    const endpointOverride = defineMiddleware<{ endpoint: null }>((request, next) => next({ endpoint: null }))
    expectTypeOf<RouteProof<typeof appApi, typeof posts, Plain, { policy: undefined }, ExtOf<[typeof endpointOverride]>>>().toHaveProperty(
      "posts.index: middleware extension 'endpoint' is reserved (a contract route keeps its own query, body and endpoint)",
    )
  })

  test('two middleware that add the same key with the same type still pass', () => {
    const tagString = defineMiddleware<{ tag: string }>((request, next) => next({ tag: 'x' }))
    const tagAgain = defineMiddleware<{ tag: string }>((request, next) => next({ tag: 'y' }))
    class NeedsString extends Controller {
      index(ctx: Ctx<typeof posts.index, { tag: string }>) { void ctx.tag.toUpperCase() }
      destroy() {}
    }
    Route.api(appApi, (r) => [r.middleware(tagString, tagAgain).contract(posts, NeedsString)])
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

  test('matches by type identity, not by subtype', () => {
    class NeedsUser extends Controller {
      index(ctx: Ctx<typeof posts.index, { user: User }>) { void ctx.user }
      destroy() {}
    }
    // `auth` is assignable to `audit`'s `TypedMiddleware<{}>`, so a subtype match would drop the extension `auth` adds
    Route.api(appApi, (r) => [r.middleware(auth, audit).withoutMiddleware(audit).contract(posts, NeedsUser)])
  })

  test('a different typed middleware stays, so its extension stays in the proof', () => {
    const queryOverride = defineMiddleware<{ query: { page: string } }>((request, next) => next({ query: { page: '1' } }))
    Route.api(appApi, (r) => {
      // The empty extension `audit` is not `queryOverride`: dropping it must not drop the reserved key either
      const withoutAudit = r.middleware(queryOverride).withoutMiddleware(audit)
      expectTypeOf(withoutAudit).toEqualTypeOf<ApiRouteBuilder<typeof appApi, [typeof queryOverride]>>()
      return [r.contract(posts, Plain)]
    })
  })

  test('still drops a 0.5 class', () => {
    Route.api(appApi, (r) => {
      const withoutAudit = r.middleware(Audit, auth).withoutMiddleware(Audit)
      expectTypeOf(withoutAudit).toEqualTypeOf<ApiRouteBuilder<typeof appApi, [typeof auth]>>()
      return [withoutAudit.contract(posts, Plain)]
    })
  })

  test('two middleware of structurally identical types are one type, so both are dropped', () => {
    const auditToo = defineMiddleware((request, next) => next())
    Route.api(appApi, (r) => {
      const withoutAudit = r.middleware(audit, auditToo).withoutMiddleware(audit)
      expectTypeOf(withoutAudit).toEqualTypeOf<ApiRouteBuilder<typeof appApi, []>>()
      return [withoutAudit.contract(posts, Plain)]
    })
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
