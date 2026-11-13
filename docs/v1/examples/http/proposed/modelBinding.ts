// docs/v1/http.md › Model binding (H7 #118): r.bind() resolves path params to models, folder params included.
// A model class is the BindableModel static side; a resolver gets the raw string and its null / undefined is a 404.
import * as z from 'zod'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Route } from '@laratype/http'
import type { Ctx } from '@laratype/http'

class User {
  declare readonly id: number
  static readonly primaryKey = 'id'
  static async findByRouteKey(key: string): Promise<User | null> {
    const id = Number(key)
    // a key the model cannot convert is its own miss (database.md › BindableModel: Key conversion)
    return Number.isInteger(id) ? Object.assign(new User(), { id }) : null
  }
}

class Post {
  declare readonly slug: string
  // Looks a post up by its slug, not its primary key
  static readonly primaryKey = 'id'
  static readonly routeKeyName = 'slug'
  static findByRouteKey(key: string): Promise<Post | undefined> {
    return Promise.resolve(key === 'missing' ? undefined : Object.assign(new Post(), { slug: key }))
  }
}

const PostDto = z.object({ id: z.number(), slug: z.string() })

// app/api/users/[user]/posts.ts: `user` is a folder param, `post` an endpoint param
const posts = defineContract()({
  show: endpoint.get('/:post').response(PostDto),
  latest: endpoint.get('/latest/:post?').response(PostDto),
})
const appApi = defineApi({ 'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [] } })

class PostController extends Controller {
  show(ctx: Ctx<typeof posts.show, { params: { user: User; post: Post } }>) {
    return { id: ctx.params.user.id, slug: ctx.params.post.slug }
  }
  latest(ctx: Ctx<typeof posts.latest, { params: { user: User; post: Post | undefined } }>) {
    // the optional param is undefined when the request has none
    return { id: ctx.params.user.id, slug: ctx.params.post?.slug ?? '' }
  }
}

export const routes = Route.api(appApi, (r) => [r.bind({ user: User, post: Post }).contract(posts, PostController)])

export const resolver = Route.api(appApi, (r) => [
  // a resolver gets the raw path param: the router never parses a route key
  r.bind({ user: (raw: string) => User.findByRouteKey(raw), post: Post }).contract(posts, PostController),
])

// A key that is not a path param of the contract fails at r.contract()
// @ts-expect-error .bind(): `comment` is not a path param of any endpoint in users.posts
export const wrongKey = Route.api(appApi, (r) => [r.bind({ user: User, comment: Post }).contract(posts, PostController)])

class Plain {
  declare readonly id: number
}
// A class without the BindableModel statics fails at r.bind()
// @ts-expect-error Type 'typeof Plain' is not assignable to type 'Binder' (missing primaryKey and findByRouteKey from BindableModelClass)
export const notBindable = Route.api(appApi, (r) => [r.bind({ user: Plain }).contract(posts, PostController)])
