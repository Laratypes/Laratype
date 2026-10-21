// Type tests for the route proof at r.contract() (H2b #105): run by `bunx vitest run --project types`.
// Each failure mode checks the readable diagnosis, a property name of the proof's error type.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from 'vitest'
import { z } from 'zod'
import { defineApi, defineContract, defineError, endpoint } from '@laratype/contract'
import { Controller, JsonResource, Route, redirect, response } from '../../src/index'
import type { ContractRouteOptions, ControllerOf, Ctx, Result, RouteProof, VerifyController } from '../../src/index'

const Post = z.object({ id: z.number(), title: z.string() })
const PostLocked = defineError(423, 'POST_LOCKED')
const posts = defineContract()({
  index: endpoint.get('/').response(z.array(Post)),
  show: endpoint.get('/:post').response(Post).throws(PostLocked),
  destroy: endpoint.delete('/:post').auth().authorize(),
})
const appApi = defineApi({ 'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [], dirs: [] } })

type Path = '/api/users/:user/posts'
type Post = z.infer<typeof Post>
class User { declare readonly id: number }
class PostModel { declare readonly id: number; declare readonly title: string }

class PostPolicy { destroy() { return true } }

class PostController extends Controller {
  index() { return [] as Post[] }
  async show(ctx: Ctx<typeof posts.show>) { return { id: Number(ctx.endpoint.def.path.length), title: 't' } }
  destroy() {}
}

// Variants of PostController replace one handler; a subclass can't, since the override would have to match
type With<H extends object> = Omit<PostController, keyof H> & H

/** The proof of `PostController`-like controllers for `posts`, with middleware extensions X, bindings B and options O. */
type Proof<I, X extends object = {}, B = {}, O = { policy: typeof PostPolicy }> = VerifyController<'users.posts', typeof posts, Path, I, X, B, O>

describe('a valid controller', () => {
  test('passes at r.contract(), by contract and by tree node', () => {
    Route.api(appApi, (r) => [r.contract(posts, PostController, { policy: PostPolicy })])
    Route.api(appApi, (r) => [r.contract(appApi.users.posts, PostController, { policy: PostPolicy })])
    expectTypeOf<Proof<PostController>>().toEqualTypeOf<unknown>()
  })

  test('a requirement the middleware provides passes (X, wired to the builder by H6 #117)', () => {
    type NeedsUser = With<{ destroy(ctx: Ctx<typeof posts.destroy, { user: User }>): void }>
    expectTypeOf<Proof<NeedsUser, { user: User }>>().toEqualTypeOf<unknown>()
  })

  test('a bound param passes (B, wired to r.bind() by H7 #118), folder params included', () => {
    class Bound extends PostController {
      async show(ctx: Ctx<typeof posts.show, { params: { post: PostModel; user: User } }>) { return ctx.params.post }
    }
    expectTypeOf<Proof<Bound, {}, { post: typeof PostModel; user: (raw: string) => Promise<User | null> }>>().toEqualTypeOf<unknown>()
  })

  test('a handler that throws a declared error passes: errors are thrown, the return check covers the response only', () => {
    class Throws extends PostController {
      async show(): Promise<Post> { throw PostLocked() }
    }
    expectTypeOf<Proof<Throws>>().toEqualTypeOf<unknown>()
  })

  test('a callable property counts as a handler (action() later); a handler typed with the request object passes', () => {
    class Props {
      index = (): Post[] => []
      show(req: { param(key: string): string }) { return { id: Number(req.param('post')), title: '' } }
      destroy() {}
    }
    expectTypeOf<Proof<Props>>().toEqualTypeOf<unknown>()
  })

  test('a response() / redirect() value or a 0.5 JsonResource passes: the runtime takes them as is', () => {
    type Escapes = With<{ index(): ReturnType<typeof response>; show(): Promise<JsonResource>; destroy(): ReturnType<typeof redirect> }>
    expectTypeOf<Proof<Escapes>>().toEqualTypeOf<unknown>()
  })

  test('an any handler passes, and a second parameter that takes the raw path params passes', () => {
    expectTypeOf<Proof<With<{ index: any }>>>().toEqualTypeOf<unknown>()
    type Raw = With<{ show(ctx: Ctx<typeof posts.show>, params: { user: string; post: string }): Post }>
    expectTypeOf<Proof<Raw>>().toEqualTypeOf<unknown>()
  })

  test('options held in a variable typed ContractRouteOptions: a policy known only as a PolicyClass is not checked', () => {
    const options: ContractRouteOptions<typeof posts> = { policy: PostPolicy }
    Route.api(appApi, (r) => [r.contract(posts, PostController, options)])
  })

  test('a handler returns null on an endpoint without a response schema', () => {
    expectTypeOf<Proof<With<{ destroy(): null }>>>().toEqualTypeOf<unknown>()
  })

  test('a policy with before covers every .authorize() endpoint', () => {
    class Before { before() { return true } }
    expectTypeOf<Proof<PostController, {}, {}, { policy: typeof Before }>>().toEqualTypeOf<unknown>()
  })
})

describe('failure modes, by their diagnosis', () => {
  test('a missing handler', () => {
    class Partial extends Controller { index() { return [] as Post[] } show() { return { id: 1, title: '' } } }
    expectTypeOf<Proof<Partial>>().toHaveProperty('users.posts.destroy: controller has no handler for this endpoint')
    // @ts-expect-error users.posts.destroy: controller has no handler for this endpoint
    Route.api(appApi, (r) => [r.contract(posts, Partial, { policy: PostPolicy })])
  })

  test('a handler typed for another endpoint', () => {
    type Crossed = With<{ show(ctx: Ctx<typeof posts.index>): Promise<Post> }>
    expectTypeOf<Proof<Crossed>>().toHaveProperty('users.posts.show: handler ctx is typed for a different endpoint')
  })

  test('a requirement the route does not provide', () => {
    class NeedsUser extends Controller {
      index() { return [] as Post[] }
      show() { return { id: 1, title: '' } }
      destroy(ctx: Ctx<typeof posts.destroy, { user: User }>) { void ctx }
    }
    expectTypeOf<Proof<NeedsUser>>().toHaveProperty('users.posts.destroy: handler requires `user`, route does not provide it (add middleware / .bind())')
    class NeedsPost extends PostController {
      async show(ctx: Ctx<typeof posts.show, { params: { post: PostModel } }>) { return ctx.params.post }
    }
    expectTypeOf<Proof<NeedsPost>>().toHaveProperty('users.posts.show: handler requires `params.post`, route does not provide it (add middleware / .bind())')
    expectTypeOf<RouteProof<typeof appApi, typeof posts, NeedsUser, { policy: typeof PostPolicy }>>().toHaveProperty(
      'users.posts.destroy: handler requires `user`, route does not provide it (add middleware / .bind())',
    )
    // @ts-expect-error users.posts.destroy: handler requires `user`
    Route.api(appApi, (r) => [r.contract(posts, NeedsUser, { policy: PostPolicy })])
  })

  test('a provided value of the wrong type', () => {
    class Other { declare readonly other: true }
    class NeedsPost extends PostController {
      async show(ctx: Ctx<typeof posts.show, { params: { post: PostModel } }>) { return ctx.params.post }
    }
    expectTypeOf<Proof<NeedsPost, {}, { post: typeof Other }>>().toHaveProperty(
      'users.posts.show: `params.post` provided by the route does not match the handler (missing .bind()?)',
    )
  })

  test('a handler ctx that no key explains (a private member)', () => {
    class Special { private secret = 1; declare readonly endpoint: typeof posts.show }
    type Private = With<{ show(req: Special): Post }>
    expectTypeOf<Proof<Private>>().toHaveProperty('users.posts.show: handler ctx does not accept what the route provides')
  })

  test('a second parameter typed as bound models (the runtime passes raw strings)', () => {
    type Models = With<{ show(ctx: Ctx<typeof posts.show>, params: { post: PostModel }): Post }>
    expectTypeOf<Proof<Models>>().toHaveProperty('users.posts.show: the second parameter gets the raw path params (strings), use .bind() and ctx')
  })

  test('without bindings the route provides no params: a required params object fails, even an empty or optional-key one', () => {
    type Optional = With<{ show(ctx: Ctx<typeof posts.show, { params: { post?: PostModel } }>): Post }>
    expectTypeOf<Proof<Optional>>().toHaveProperty('users.posts.show: handler requires `params`, route does not provide it (add middleware / .bind())')
    type Empty = With<{ show(ctx: Ctx<typeof posts.show, { params: {} }>): Post }>
    expectTypeOf<Proof<Empty>>().toHaveProperty('users.posts.show: handler requires `params`, route does not provide it (add middleware / .bind())')
  })

  test('an optional or rest second parameter typed as models', () => {
    type Optional = With<{ show(ctx: Ctx<typeof posts.show>, params?: { post: PostModel }): Post }>
    expectTypeOf<Proof<Optional>>().toHaveProperty('users.posts.show: the second parameter gets the raw path params (strings), use .bind() and ctx')
    type Rest = With<{ show(ctx: Ctx<typeof posts.show>, ...rest: PostModel[]): Post }>
    expectTypeOf<Proof<Rest>>().toHaveProperty('users.posts.show: the second parameter gets the raw path params (strings), use .bind() and ctx')
  })

  test('a request member of the wrong type points at request classes, not .bind()', () => {
    type Rules = With<{ show(req: { endpoint: typeof posts.show; rules(): number }): Post }>
    expectTypeOf<Proof<Rules>>().toHaveProperty(
      'users.posts.show: `rules` of the request does not match the handler (Route.api passes the raw request; request classes are #106)',
    )
  })

  test('an endpoint named after a base Controller member has no handler on a bare controller', () => {
    const odd = defineContract()({ exposed: endpoint.get('/') })
    class Bare extends Controller {}
    expectTypeOf<VerifyController<'odd', typeof odd, '/odd', Bare>>().toHaveProperty('odd.exposed: controller has no handler for this endpoint')
  })

  test('a wrong return type', () => {
    type Wrong = With<{ index(): string }>
    expectTypeOf<Proof<Wrong>>().toHaveProperty('users.posts.index: return type does not match the response schema')
    // without a response schema the handler returns nothing
    type Returns = With<{ destroy(): { gone: true } }>
    expectTypeOf<Proof<Returns>>().toHaveProperty('users.posts.destroy: return type does not match the response schema')
  })

  test('a .bind() key that is not a path param', () => {
    expectTypeOf<Proof<PostController, {}, { comment: typeof PostModel }>>().toHaveProperty(
      '.bind(): `comment` is not a path param of any endpoint in users.posts',
    )
  })

  test('.authorize() without a policy, or with a policy that has no method for it', () => {
    expectTypeOf<Proof<PostController, {}, {}, {}>>().toHaveProperty("users.posts.destroy: endpoint has .authorize() but r.contract() has no { policy }")
    class Empty { show() { return true } }
    expectTypeOf<Proof<PostController, {}, {}, { policy: typeof Empty }>>().toHaveProperty(
      'users.posts.destroy: .authorize() needs a `destroy` method or `before` on the policy',
    )
    class Nothing {}
    expectTypeOf<Proof<PostController, {}, {}, { policy: typeof Nothing }>>().toHaveProperty(
      'users.posts.destroy: .authorize() needs a `destroy` method or `before` on the policy',
    )
    // a property that is not a method doesn't count, for the endpoint's name or for before
    class Fields { destroy = 1; before = true }
    expectTypeOf<Proof<PostController, {}, {}, { policy: typeof Fields }>>().toHaveProperty(
      'users.posts.destroy: .authorize() needs a `destroy` method or `before` on the policy',
    )
    // a policy that may be undefined is no policy
    const maybe = Math.random() > 1 ? PostPolicy : undefined
    expectTypeOf<Proof<PostController, {}, {}, { policy: typeof maybe }>>().toHaveProperty(
      'users.posts.destroy: endpoint has .authorize() but r.contract() has no { policy }',
    )
    // @ts-expect-error users.posts.destroy: endpoint has .authorize() but r.contract() has no { policy }
    Route.api(appApi, (r) => [r.contract(posts, PostController, { policy: maybe })])
    // .authorize(flag) with a boolean flag may authorize, so it is checked too
    const flag = Math.random() > 1
    const flagged = defineContract()({ destroy: endpoint.delete('/:post').auth().authorize(flag) })
    expectTypeOf<VerifyController<'flagged', typeof flagged, '/f', { destroy(): void }>>().toHaveProperty(
      'flagged.destroy: endpoint has .authorize() but r.contract() has no { policy }',
    )
    // @ts-expect-error users.posts.destroy: endpoint has .authorize() but r.contract() has no { policy }
    Route.api(appApi, (r) => [r.contract(posts, PostController)])
    // @ts-expect-error users.posts.destroy: .authorize() needs a `destroy` method or `before` on the policy
    Route.api(appApi, (r) => [r.contract(posts, PostController, { policy: Empty })])
  })
})

describe('Ctx, Result and ControllerOf', () => {
  test('Ctx is the endpoint plus Requires; params, query and body come with H3 #106', () => {
    expectTypeOf<Ctx<typeof posts.show>>().toEqualTypeOf<{ readonly endpoint: typeof posts.show }>()
    expectTypeOf<Ctx<typeof posts.show, { user: User }>['user']>().toEqualTypeOf<User>()
    // Honest until H3: the runtime passes no params object yet, so destructuring it does not compile. H3 flips this
    // @ts-expect-error Property 'params' does not exist
    const show = ({ params }: Ctx<typeof posts.show>) => params
    void show
  })

  test('Result is the response schema input, void without one', () => {
    expectTypeOf<Result<typeof posts.show>>().toEqualTypeOf<{ id: number; title: string }>()
    expectTypeOf<Result<typeof posts.destroy>>().toEqualTypeOf<void>()
  })

  test('implements ControllerOf reports a missing handler or a wrong return at the class', () => {
    class Good extends Controller implements ControllerOf<typeof posts> {
      index() { return [] as Post[] }
      show() { return { id: 1, title: '' } }
      destroy() {}
    }
    void Good
    // @ts-expect-error Class 'Partial' incorrectly implements ControllerOf: destroy is missing
    class Partial extends Controller implements ControllerOf<typeof posts> {
      index() { return [] as Post[] }
      show() { return { id: 1, title: '' } }
    }
    class Wrong extends Controller implements ControllerOf<typeof posts> {
      // @ts-expect-error index returns a string, not the response schema input
      index() { return 'posts' }
      show() { return { id: 1, title: '' } }
      destroy() {}
    }
    void Partial
    void Wrong
  })
})
