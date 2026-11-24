// Type tests for the contract authorization compile checks (H8 #122): an endpoint whose authorize resolves true needs
// the contract policy's method (or `before`), and the method must accept the endpoint's own bound models in path order.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from 'vitest'
import { defineApi, defineContract, defineScope, endpoint } from '@laratype/contract'
import type { ContractPrefix } from '@laratype/contract'
import { Controller, Route } from '../../src/index'
import type { RouteProof } from '../../src/index'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const

class User { declare readonly id: number }
class PostModel {
  static readonly primaryKey = 'id'
  static async findByRouteKey(_key: string): Promise<PostModel | null> { return null }
  declare readonly id: number
  declare readonly userId: number
}

class PostPolicy {
  update(user: User, post: PostModel) { return user.id === post.userId }
  remove(user: User) { return true }
}
class BeforePolicy {
  before() { return null }
}
class EmptyPolicy {}
class WrongPolicy {
  update(_user: User, _params: { post: PostModel }) { return true }
  remove() { return true }
}
class OptionalPolicy {
  update(_user: User, _post?: PostModel) { return true }
  remove() { return true }
}
class RequiredPolicy {
  update(_user: User, _post: PostModel) { return true }
  remove() { return true }
}

const root = defineScope()({ auth: true, authorize: true })
const posts = defineContract<ContractPrefix<'/api/users/:user/posts', [typeof root]>>()({
  update: endpoint.patch('/:post').response(anything),
  remove: endpoint.delete('/:post').response(anything),
})
const appApi = defineApi({
  'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [{ scope: root, dir: '' }] },
})

class PostController extends Controller {
  update() { return { ok: true } }
  remove() { return { ok: true } }
}

const bound = { post: PostModel }

describe('the resolved-authorize policy check', () => {
  test('a passing route: the methods accept the bound models, and a before hook covers them all', () => {
    Route.api(appApi, (r) => [
      r.bind(bound).scope('', { policy: BeforePolicy }),
      r.bind(bound).contract(posts, PostController, { policy: PostPolicy }),
    ])
    expectTypeOf<RouteProof<typeof appApi, typeof posts, PostController, { policy: typeof PostPolicy }, {}, typeof bound>>().toEqualTypeOf<unknown>()
    expectTypeOf<RouteProof<typeof appApi, typeof posts, PostController, { policy: typeof BeforePolicy }, {}, typeof bound>>().toEqualTypeOf<unknown>()
  })

  test('a scope-inherited authorize needs the method on a mounted contract policy', () => {
    expectTypeOf<RouteProof<typeof appApi, typeof posts, PostController, { policy: typeof EmptyPolicy }, {}, typeof bound>>().toHaveProperty(
      'users.posts.update: .authorize() needs a `update` method or `before` on the policy',
    )
    expectTypeOf<RouteProof<typeof appApi, typeof posts, PostController, { policy: typeof EmptyPolicy }, {}, typeof bound>>().toHaveProperty(
      'users.posts.remove: .authorize() needs a `remove` method or `before` on the policy',
    )
    Route.api(appApi, (r) => [
      r.bind(bound).scope('', { policy: BeforePolicy }),
      // @ts-expect-error users.posts.update: .authorize() needs a `update` method or `before` on the policy
      r.bind(bound).contract(posts, PostController, { policy: EmptyPolicy }),
    ])
  })

  test('the method must accept the bound models the route passes, in path order', () => {
    expectTypeOf<RouteProof<typeof appApi, typeof posts, PostController, { policy: typeof WrongPolicy }, {}, typeof bound>>().toHaveProperty(
      "users.posts.update: the policy's `update` method does not accept the bound models the route passes (post)",
    )
    Route.api(appApi, (r) => [
      r.bind(bound).scope('', { policy: BeforePolicy }),
      // @ts-expect-error users.posts.update: the policy's `update` method does not accept the bound models the route passes (post)
      r.bind(bound).contract(posts, PostController, { policy: WrongPolicy }),
    ])
  })

  test('a method that needs a model the route does not bind fails, and a method with fewer parameters is fine', () => {
    class NeedsComment {
      update(_user: User, _comment: { comment: string }) { return true }
      remove() { return true }
    }
    expectTypeOf<RouteProof<typeof appApi, typeof posts, PostController, { policy: typeof NeedsComment }, {}, typeof bound>>().toHaveProperty(
      "users.posts.update: the policy's `update` method does not accept the bound models the route passes (post)",
    )
    // A method with fewer parameters ignores the extra bound model: PostPolicy.remove(user) has none and passes
    expectTypeOf<RouteProof<typeof appApi, typeof posts, PostController, { policy: typeof PostPolicy }, {}, typeof bound>>().toEqualTypeOf<unknown>()
  })

  test('an optional model parameter accepts a missing model, a required one does not', () => {
    // With the binding: both accept the PostModel
    expectTypeOf<RouteProof<typeof appApi, typeof posts, PostController, { policy: typeof OptionalPolicy }, {}, typeof bound>>().toEqualTypeOf<unknown>()
    expectTypeOf<RouteProof<typeof appApi, typeof posts, PostController, { policy: typeof RequiredPolicy }, {}, typeof bound>>().toEqualTypeOf<unknown>()
    // Without it, the route passes undefined: the optional method accepts, the required one is diagnosed
    expectTypeOf<RouteProof<typeof appApi, typeof posts, PostController, { policy: typeof OptionalPolicy }, {}, {}>>().toEqualTypeOf<unknown>()
    expectTypeOf<RouteProof<typeof appApi, typeof posts, PostController, { policy: typeof RequiredPolicy }, {}, {}>>().toHaveProperty(
      "users.posts.update: the policy's `update` method does not accept the bound models the route passes (post)",
    )
  })

  test('a regex-optional param is named as the runtime names it', () => {
    // Hono accepts `:post{re}?`: the trailing `?` is the optional marker and the braces hold the regex. The proof must
    // read `post`, as pathParamNames does, or the policy gets the wrong model and the diagnosis names `post{[0-9]+}`.
    const regexPosts = defineContract<ContractPrefix<'/api/regex-posts', [typeof root]>>()({
      update: endpoint.patch('/:post{[0-9]+}?').response(anything),
    })
    const regexApi = defineApi({
      'regex.posts': { contract: regexPosts, path: '/api/regex-posts', scopes: [{ scope: root, dir: '' }] },
    })
    class RegexController extends Controller {
      update() { return { ok: true } }
    }
    // The optional path param reaches an optional policy parameter, so this route passes
    expectTypeOf<RouteProof<typeof regexApi, typeof regexPosts, RegexController, { policy: typeof OptionalPolicy }, {}, typeof bound>>().toEqualTypeOf<unknown>()
    // The wrong model type is still a compile error, named after the runtime's param (`post`, not `post{[0-9]+}`)
    class WrongRegexPolicy {
      update(_user: User, _post?: { id: string }) { return true }
    }
    expectTypeOf<RouteProof<typeof regexApi, typeof regexPosts, RegexController, { policy: typeof WrongRegexPolicy }, {}, typeof bound>>().toHaveProperty(
      "regex.posts.update: the policy's `update` method does not accept the bound models the route passes (post)",
    )
    Route.api(regexApi, (r) => [
      r.bind(bound).scope('', { policy: BeforePolicy }),
      // @ts-expect-error regex.posts.update: the policy's `update` method does not accept the bound models the route passes (post)
      r.bind(bound).contract(regexPosts, RegexController, { policy: WrongRegexPolicy }),
    ])
  })

  test('an authorize flag typed boolean is checked, .authorize(false) is not', () => {
    const authOnly = defineScope()({ auth: true })
    const flag = true as boolean
    const flagged = defineContract<ContractPrefix<'/api/flagged', [typeof authOnly]>>()({
      update: endpoint.patch('/:post').authorize(flag).response(anything),
    })
    const flaggedApi = defineApi({
      flagged: { contract: flagged, path: '/api/flagged', scopes: [{ scope: authOnly, dir: '' }] },
    })
    class FlaggedController extends Controller {
      update() { return { ok: true } }
    }
    class NoFlaggedMethod {}
    class FlaggedPolicy {
      update() { return true }
    }
    expectTypeOf<RouteProof<typeof flaggedApi, typeof flagged, FlaggedController, { policy: typeof NoFlaggedMethod }, {}, typeof bound>>().toHaveProperty(
      'flagged.update: .authorize() needs a `update` method or `before` on the policy',
    )
    Route.api(flaggedApi, (r) => [
      r.bind(bound).contract(flagged, FlaggedController, { policy: FlaggedPolicy }),
    ])
    Route.api(flaggedApi, (r) => [
      // @ts-expect-error flagged.update: .authorize() needs a `update` method or `before` on the policy
      r.bind(bound).contract(flagged, FlaggedController, { policy: NoFlaggedMethod }),
    ])

    // .authorize(false) opts out even under a scope with authorize: a policy without an `index` method is enough
    const optedOut = defineContract<ContractPrefix<'/api/opted-out', [typeof root]>>()({
      index: endpoint.get('/').authorize(false).response(anything),
    })
    const optedOutApi = defineApi({
      optedOut: { contract: optedOut, path: '/api/opted-out', scopes: [{ scope: root, dir: '' }] },
    })
    class OptedOutController extends Controller {
      index() { return { ok: true } }
    }
    // A checked policy (not an empty class, which the proof treats as unknown) with no `index` and no `before`
    class UnrelatedPolicy {
      update() { return true }
    }
    Route.api(optedOutApi, (r) => [
      r.bind({}).scope('', { policy: BeforePolicy }),
      r.bind({}).contract(optedOut, OptedOutController, { policy: UnrelatedPolicy }),
    ])
    expectTypeOf<RouteProof<typeof optedOutApi, typeof optedOut, OptedOutController, { policy: typeof UnrelatedPolicy }, {}, {}>>().toEqualTypeOf<unknown>()
  })
})
