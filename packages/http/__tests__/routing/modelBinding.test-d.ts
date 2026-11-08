// Type tests for r.bind() (H7 #118): the bound key check, the binder types and the optional path param.
// Run by `bunx vitest run --project types`. Each failure mode checks the readable diagnosis, a property name of the
// proof's error type or the bind argument's.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from 'vitest'
import { defineApi, defineContract, defineScope, endpoint } from '@laratype/contract'
import type { ContractPrefix } from '@laratype/contract'
import { Controller, Route, defineMiddleware } from '../../src/index'
import type { Ctx } from '../../src/index'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const

const root = defineScope()({ auth: true })
const usersUser = defineScope<ContractPrefix<'/api/users/:user', [typeof root]>>()({})

// app/api/users/[user]/posts.ts: the `user` param comes from the folder tree, `post` from the endpoint.
const posts = defineContract()({
  index: endpoint.get('/').response(anything),
  show: endpoint.get('/:post').response(anything),
  latest: endpoint.get('/latest/:post?').response(anything),
})
const appApi = defineApi({
  'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [{ scope: root, dir: '' }, { scope: usersUser, dir: 'users/[user]' }] },
})

class User {
  declare readonly id: number
  static readonly primaryKey = 'id'
  static async findByRouteKey(key: string): Promise<User | null> { return key === '' ? null : new User() }
}

class Post {
  declare readonly slug: string
  static readonly primaryKey = 'id'
  static readonly routeKeyName = 'slug'
  static findByRouteKey(key: string): Promise<Post | null> { return Promise.resolve(new Post()) }
}

/** A second binder for `user`: a later `.bind()` replaces the key, as at runtime. */
class Admin extends User {
  declare readonly admin: true
}

class PostPolicy {}

/** A controller that declares every bound param: both folder and endpoint params, the optional one included. */
class BoundController extends Controller {
  index() { return {} }
  show(ctx: Ctx<typeof posts.show, { params: { user: User; post: Post } }>) { return ctx.params.post }
  latest(ctx: Ctx<typeof posts.latest, { params: { user: User; post: Post | undefined } }>) { return ctx.params.post }
}

describe('r.bind()', () => {
  test('a model class binds its instance, a resolver its NonNullable result, folder params included', () => {
    Route.api(appApi, (r) => [r.bind({ user: User, post: Post }).contract(posts, BoundController)])

    Route.api(appApi, (r) => [
      r.bind({ user: User, post: (raw) => Promise.resolve(raw === '' ? null : new Post()) }).contract(posts, BoundController),
    ])

    // the resolver's raw param is a string: it comes from the path, never parsed
    Route.api(appApi, (r) => [
      r.bind({
        user: User,
        post: (raw) => {
          expectTypeOf(raw).toEqualTypeOf<string>()
          return new Post()
        },
      }).contract(posts, BoundController),
    ])
  })

  test('a scope binding proves the contract mounted from the same builder', () => {
    Route.api(appApi, (r) => {
      const bound = r.bind({ user: User, post: Post })
      return [bound.scope('users/[user]', { policy: PostPolicy }), bound.contract(posts, BoundController)]
    })
  })

  test('a later bind replaces a key it binds again, as at runtime', () => {
    class AdminController extends Controller {
      index() { return {} }
      show(ctx: Ctx<typeof posts.show, { params: { user: Admin; post: Post } }>) {
        expectTypeOf(ctx.params.user).toEqualTypeOf<Admin>()
        return ctx.params.post
      }
      latest() { return {} }
    }
    Route.api(appApi, (r) => [r.bind({ user: User, post: Post }).bind({ user: Admin }).contract(posts, AdminController)])
  })

  test('a binding wins a params key a typed middleware also adds, in the proof and at runtime', () => {
    const stale = defineMiddleware<{ params: { post: string } }>((_request, next) => next({ params: { post: 'stale' } }))

    class NeedsPost extends Controller {
      index() { return {} }
      show(ctx: Ctx<typeof posts.show, { params: { user: User; post: Post } }>) { return ctx.params.post }
      latest() { return {} }
    }
    Route.api(appApi, (r) => [r.middleware(stale).bind({ user: User, post: Post }).contract(posts, NeedsPost)])

    class NeedsString extends Controller {
      index() { return {} }
      show(ctx: Ctx<typeof posts.show, { params: { user: User; post: string } }>) { return ctx.params.post }
      latest() { return {} }
    }
    // @ts-expect-error users.posts.show: `params.post` provided by the route does not match the handler (missing .bind()?)
    Route.api(appApi, (r) => [r.middleware(stale).bind({ user: User, post: Post }).contract(posts, NeedsString)])
  })

  test('a contract mounted from another builder is not proven against a scope binding (as H6 scope middleware)', () => {
    // @ts-expect-error users.posts.show: `params.user` provided by the route does not match the handler (missing .bind()?)
    Route.api(appApi, (r) => [r.bind({ user: User, post: Post }).scope('users/[user]', { policy: PostPolicy }), r.contract(posts, BoundController)])
  })

  test('a key that is not a path param fails at r.contract()', () => {
    Route.api(appApi, (r) => [
      // @ts-expect-error .bind(): `comment` is not a path param of any endpoint in users.posts
      r.bind({ user: User, post: Post, comment: Post }).contract(posts, BoundController),
    ])
  })

  test('a class that does not satisfy BindableModel fails at r.bind()', () => {
    class Plain { declare readonly id: number }
    class PlainController extends Controller {
      index() { return {} }
      show() { return {} }
      latest() { return {} }
    }
    Route.api(appApi, (r) => {
      // @ts-expect-error Type 'typeof Plain' is not assignable to type 'Binder' (missing primaryKey and findByRouteKey from BindableModelClass)
      r.bind({ post: Plain })
      return [r.contract(posts, PlainController)]
    })
  })

  test('an optional path param binds Model | undefined; a handler that needs the model itself fails', () => {
    class NeedsPost extends Controller {
      index() { return {} }
      show() { return {} }
      latest(ctx: Ctx<typeof posts.latest, { params: { user: User; post: Post } }>) { return ctx.params.post }
    }
    // @ts-expect-error users.posts.latest: `params.post` provided by the route does not match the handler (missing .bind()?)
    Route.api(appApi, (r) => [r.bind({ user: User, post: Post }).contract(posts, NeedsPost)])
  })
})

describe('the bound params in the proof', () => {
  test('a handler without .bind() still gets the raw string', () => {
    class Raw extends Controller {
      index() { return {} }
      show(ctx: Ctx<typeof posts.show>) { return ctx.params.post }
      latest() { return {} }
    }
    Route.api(appApi, (r) => [r.contract(posts, Raw)])
    expectTypeOf<Ctx<typeof posts.show>['params']>().toEqualTypeOf<{ post: string }>()
  })
})
