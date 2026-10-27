// docs/v1/http.md › Resources (H9 #123): a resource's output is checked against the contract's response schema.
import { expectTypeOf } from 'vitest'
import * as z from 'zod'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Route, defineResource, when } from '@laratype/http'
import type { Ctx } from '@laratype/http'

class Post { declare readonly id: number; declare readonly title: string }
class User {
  declare readonly id: number
  declare readonly name: string
  declare readonly email: string
  declare readonly isAdmin: boolean
  declare readonly posts: Post[]
}

const PostResource = defineResource(Post, (post) => ({ id: post.id, title: post.title }))

export const UserResource = defineResource(User, (user) => ({
  id: user.id,
  name: user.name,
  email: when(user.isAdmin, user.email),       // left out for a non-admin
  posts: PostResource.collection(user.posts),
}))

expectTypeOf(UserResource.make).returns.toEqualTypeOf<{
  id: number; name: string; posts: { id: number; title: string }[]; email?: string
}>()

// The contract is the source of truth: the resource must satisfy its response schema
const UserDto = z.object({
  id: z.number(), name: z.string(), email: z.string().optional(), posts: z.array(z.object({ id: z.number(), title: z.string() })),
})
const users = defineContract()({
  index: endpoint.get('/').response(z.object({ data: z.array(UserDto), total: z.number() })),
  show: endpoint.get('/:user').response(UserDto),
})
const appApi = defineApi({ users: { contract: users, path: '/api/users', scopes: [], dirs: [] } })

declare const findUser: (ctx: Ctx<typeof users.show>) => Promise<User>

class UserController extends Controller {
  index() { return UserResource.paginate({ data: [] as User[], total: 0 }) }
  async show(ctx: Ctx<typeof users.show>) { return UserResource.make(await findUser(ctx)) }
}

export const routes = Route.api(appApi, (r) => [r.contract(users, UserController)])

// A resource whose email is optional fails a contract that requires it, at r.contract()
const strict = defineContract()({ show: endpoint.get('/:user').response(UserDto.required({ email: true })) })
const strictApi = defineApi({ users: { contract: strict, path: '/api/users', scopes: [], dirs: [] } })
class StrictController extends Controller {
  async show(ctx: Ctx<typeof strict.show>) { return UserResource.make(await findUser(ctx as never)) }
}
// @ts-expect-error users.show: return type does not match the response schema
Route.api(strictApi, (r) => [r.contract(strict, StrictController)])
