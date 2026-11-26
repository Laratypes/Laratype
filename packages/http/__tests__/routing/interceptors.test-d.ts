// Type tests for interceptors (H11 #138, docs/v1/http.md › Interceptors): the public API, the result-parametric
// generic form (amendment A), the generic-only scope rule (amendment B, type-level only) and the route proof.
// Run by `bunx vitest run --project types`.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from 'vitest'
import { z } from 'zod'
import { defineApi, defineContract, defineScope, endpoint } from '@laratype/contract'
import type { AnyEndpoint, ContractPrefix } from '@laratype/contract'
import {
  Controller,
  Route,
  defineInterceptor,
  defineMiddleware,
  isInterceptor,
} from '../../src/index'
import type {
  AnyInterceptor,
  ApiRouteBuilder,
  Ctx,
  Intercepted,
  Interceptor,
  InterceptorHandler,
  ResponseEscape,
  Result,
} from '../../src/index'

const PostDto = z.object({ id: z.number() })
const one = defineContract()({ show: endpoint.get('/:post').response(PostDto) })
const oneApi = defineApi({ one: { contract: one, path: '/api/one', scopes: [] } })

const posts = defineContract()({
  index: endpoint.get('/').response(z.object({ items: z.array(z.object({ name: z.string() })) })),
  show: endpoint.get('/:post').response(PostDto),
  destroy: endpoint.delete('/:post').status(204),
})
const postsApi = defineApi({ posts: { contract: posts, path: '/api/posts', scopes: [] } })

const scoped = defineScope<ContractPrefix<'/api/users/:user', []>>()({ authorize: false })
const scopedOne = defineContract()({ show: endpoint.get('/:post').response(PostDto) })
const scopedApi = defineApi({
  'users.one': { contract: scopedOne, path: '/api/users/:user/one', scopes: [{ scope: scoped, dir: 'users/[user]' }] },
})

class OneController extends Controller {
  show() { return { id: 1 } }
}
class PostsController extends Controller {
  index() { return { items: [] } }
  show() { return { id: 1 } }
  destroy() {}
}
class ScopedController extends Controller {
  show() { return { id: 1 } }
}
class Policy {}

class User {
  declare readonly id: number
}
class Post {
  declare readonly id: number
}
const postResolver = (_raw: string) => new Post()

describe('the public API', () => {
  test('defineInterceptor builds the generic and endpoint-pinned forms', () => {
    const generic = defineInterceptor((ctx, next) => next())
    const pinned = defineInterceptor<typeof one.show>((ctx, next) => next())
    const pinnedRequires = defineInterceptor<typeof one.show, { user: User }>((ctx, next) => {
      void ctx.user
      return next()
    })
    expectTypeOf(generic).toMatchTypeOf<AnyInterceptor>()
    expectTypeOf(pinned).toMatchTypeOf<Interceptor<typeof one.show>>()
    expectTypeOf(pinnedRequires).toMatchTypeOf<Interceptor<typeof one.show, { user: User }>>()
    const any: AnyInterceptor = generic
    const concrete: Interceptor<typeof one.show> = pinned
    const both: Interceptor<typeof one.show>[] = [generic, pinned]
    void [any, concrete, both]
  })

  test('InterceptorHandler and Intercepted describe the ctx, next() and the final value', () => {
    expectTypeOf<Parameters<InterceptorHandler<typeof one.show, { user: User }>>[0]>().toEqualTypeOf<Ctx<typeof one.show, { user: User }>>()
    expectTypeOf<Parameters<InterceptorHandler<typeof one.show>>[1]>().toEqualTypeOf<() => Promise<Intercepted<typeof one.show>>>()
    expectTypeOf<Intercepted<typeof one.show>>().toEqualTypeOf<Result<typeof one.show> | ResponseEscape>()
    expectTypeOf<Result<typeof one.show>>().toEqualTypeOf<{ id: number }>()
  })

  test('isInterceptor narrows to AnyInterceptor', () => {
    const value: unknown = defineInterceptor((ctx, next) => next())
    if (isInterceptor(value)) expectTypeOf(value).toEqualTypeOf<AnyInterceptor>()
    expectTypeOf(defineInterceptor).toBeFunction()
  })
})

describe('amendment A: the generic form is result-parametric', () => {
  test('a generic interceptor can only pass through, or return with a visible cast', () => {
    const generic = defineInterceptor(async <R>(ctx: Ctx<AnyEndpoint>, next: () => Promise<R>): Promise<R> => {
      void ctx
      return next()
    })
    const store = new Map<string, unknown>()
    // A cache hit needs the explicit `as R` cast: without it the cached value is `unknown`.
    const cache = defineInterceptor(async <R>(ctx: Ctx<AnyEndpoint>, next: () => Promise<R>): Promise<R> => {
      const hit = store.get(ctx.endpoint.def.path) as R | undefined
      if (hit !== undefined) return hit
      return next()
    })
    expectTypeOf(generic).toMatchTypeOf<AnyInterceptor>()
    expectTypeOf(cache).toMatchTypeOf<AnyInterceptor>()

    // @ts-expect-error a generic interceptor cannot return an arbitrary shape without a cast
    defineInterceptor(async (_ctx: Ctx<AnyEndpoint>, _next: () => Promise<{ id: number }>) => ({ arbitrary: true }))
    // @ts-expect-error an endpoint-pinned interceptor returns the response schema input
    defineInterceptor<typeof one.show>(() => ({ id: 'x' }))
  })
})

describe('amendment B: scope-level registration is generic-only (type-level)', () => {
  test('a generic interceptor at a scope, a contract and an endpoint is OK', () => {
    const generic = defineInterceptor((ctx, next) => next())
    Route.api(scopedApi, (r) => [
      r.interceptor(generic).scope('users/[user]', { policy: Policy }),
      r.contract(scopedOne, ScopedController),
    ])
    Route.api(oneApi, (r) => [r.interceptor(generic).contract(one, OneController)])
    Route.api(oneApi, (r) => [r.contract(one, OneController, { endpoints: { show: (r) => r.interceptor(generic) } })])
  })

  test('a concrete interceptor at a scope is the named type error', () => {
    const concrete = defineInterceptor<typeof scopedOne.show>((ctx, next) => next())
    Route.api(scopedApi, (r) => {
      const base = r.interceptor(concrete)
      return [
        // @ts-expect-error scope "users/[user]": interceptor is endpoint-specific; mount it on r.contract() or an endpoint
        base.scope('users/[user]', { policy: Policy }),
        base.contract(scopedOne, ScopedController),
      ]
    })
  })

  test('a concrete interceptor at a contract and an endpoint is OK', () => {
    const concrete = defineInterceptor<typeof one.show>((ctx, next) => next())
    Route.api(oneApi, (r) => [r.interceptor(concrete).contract(one, OneController)])
    Route.api(oneApi, (r) => [r.contract(one, OneController, { endpoints: { show: (r) => r.interceptor(concrete) } })])
  })
})

describe('the interceptor route proof', () => {
  test('a concrete interceptor is checked against every endpoint of a contract', () => {
    const showOnly = defineInterceptor<typeof posts.show>((ctx, next) => next())
    Route.api(postsApi, (r) => [
      // @ts-expect-error posts.index: interceptor result does not match the response schema
      r.interceptor(showOnly).contract(posts, PostsController),
    ])
  })

  test('an endpoint callback checks the interceptor against its endpoint', () => {
    const showOnly = defineInterceptor<typeof posts.show>((ctx, next) => next())
    Route.api(postsApi, (r) => [
      // @ts-expect-error endpoint callback: interceptor result does not match the response schema
      r.contract(posts, PostsController, { endpoints: { index: (r) => r.interceptor(showOnly) } }),
    ])
  })

  test('a concrete interceptor can require a middleware extension the route provides', () => {
    const needsUser = defineInterceptor<typeof one.show, { user: User }>((ctx, next) => {
      void ctx.user
      return next()
    })
    Route.api(oneApi, (r) => [
      // @ts-expect-error one.show: interceptor does not accept the handler's ctx
      r.interceptor(needsUser).contract(one, OneController),
    ])
    const auth = defineMiddleware<{ user: User }>((_request, next) => next({ user: new User() }))
    Route.api(oneApi, (r) => [r.middleware(auth).interceptor(needsUser).contract(one, OneController)])
  })

  test('a concrete interceptor can require a bound model the route binds', () => {
    const needsPost = defineInterceptor<typeof one.show, { params: { post: Post } }>((ctx, next) => {
      void ctx.params.post
      return next()
    })
    Route.api(oneApi, (r) => [
      // @ts-expect-error one.show: interceptor does not accept the handler's ctx
      r.interceptor(needsPost).contract(one, OneController),
    ])
    Route.api(oneApi, (r) => [r.bind({ post: postResolver }).interceptor(needsPost).contract(one, OneController)])
  })

  test('an ad-hoc route cannot follow an interceptor', () => {
    const generic = defineInterceptor((ctx, next) => next())
    const build = (r: ApiRouteBuilder<typeof oneApi>) => {
      // @ts-expect-error an ad-hoc route cannot follow an interceptor (`never`)
      r.interceptor(generic).get('/health', () => 'ok')
    }
    void build
  })
})
