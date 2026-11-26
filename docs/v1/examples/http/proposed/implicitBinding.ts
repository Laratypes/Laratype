// docs/v1/http.md › Model binding (H14 #163): a path param whose name is a registered model binds implicitly.
// `.laratype/types/models.d.ts` writes the `Register['models']` block below (shown inline here); `sauf types:generate`
// derives it from app/models/User.ts and app/models/Post.ts, each default-exporting its class.
import * as z from 'zod'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Route } from '@laratype/http'
import type { Ctx } from '@laratype/http'

class User {
  declare readonly id: number
  static readonly primaryKey = 'id'
  // The second parameter is what `.scopeBindings()` passes to a child lookup; declare it even when unused
  static async findByRouteKey(key: string, _scope?: Readonly<Record<string, object>>): Promise<User | null> {
    const id = Number(key)
    return Number.isInteger(id) ? Object.assign(new User(), { id }) : null
  }
}

class Post {
  declare readonly slug: string
  static readonly primaryKey = 'id'
  static readonly routeKeyName = 'slug'
  static async findByRouteKey(key: string, scope?: Readonly<Record<string, object>>): Promise<Post | null> {
    // The base Model walks the user relation itself; this stub only shows the argument
    return scope?.user === undefined || key === 'missing' ? null : Object.assign(new Post(), { slug: key })
  }
}

// .laratype/types/models.d.ts (generated)
declare module '@laratype/http' {
  interface Register {
    models: {
      post: typeof Post
      user: typeof User
    }
  }
}

const UserDto = z.object({ id: z.number() })
const PostDto = z.object({ slug: z.string() })

// app/api/users.ts: `:user` is the endpoint's own param, so Ctx knows its model
const users = defineContract()({
  show: endpoint.get('/:user').response(UserDto),
  latest: endpoint.get('/latest/:user?').response(UserDto),
})
const usersApi = defineApi({ users: { contract: users, path: '/api/users', scopes: [] } })

class UserController extends Controller {
  show(ctx: Ctx<typeof users.show>) {
    // User: no .bind() and no Requires entry
    return { id: ctx.params.user.id }
  }
  latest(ctx: Ctx<typeof users.latest>) {
    // an optional param is `User | undefined`
    return { id: ctx.params.user?.id ?? 0 }
  }
}

export const routes = Route.api(usersApi, (r) => [r.contract(users, UserController)])

// Nested params: `user` is a folder param (listed in Requires), `post` an endpoint param of the posts contract.
// `.scopeBindings()` looks `post` up with `{ user }`, so another user's post is the 404.
const posts = defineContract()({ show: endpoint.get('/:post').response(PostDto) })
const appApi = defineApi({
  'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [] },
})

class PostController extends Controller {
  show(ctx: Ctx<typeof posts.show, { params: { user: User } }>) {
    return { slug: ctx.params.post.slug, userId: ctx.params.user.id }
  }
}

export const scoped = Route.api(appApi, (r) => [r.scopeBindings().contract(posts, PostController)])

// The opt-out: what this builder mounts binds no registered model. An explicit .bind() still binds its own keys.
class RawUserController extends Controller {
  show(ctx: Ctx<typeof users.show, { params: { user: string } }>) {
    return { id: Number(ctx.params.user) }
  }
  latest() {
    return { id: 0 }
  }
}

export const optOut = Route.api(usersApi, (r) => [r.withoutImplicitBinding().contract(users, RawUserController)])
export const optOutBound = Route.api(usersApi, (r) => [
  r.withoutImplicitBinding().bind({ user: (raw: string) => User.findByRouteKey(raw) }).contract(users, UserController),
])

class Other {
  declare readonly id: string
}
class WrongController extends Controller {
  show(ctx: Ctx<typeof users.show, { params: { user: Other } }>) {
    return { id: 0 }
  }
  latest() {
    return { id: 0 }
  }
}
// @ts-expect-error users.show: `params.user` provided by the route does not match the handler (missing .bind()?)
export const wrong = Route.api(usersApi, (r) => [r.contract(users, WrongController)])
