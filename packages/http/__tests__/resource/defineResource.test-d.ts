// Type tests for Resource v2 (H9 #123): the inferred output, and its check against the contract's response schema
// at r.contract(). Run by `bunx vitest run --project types`.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from 'vitest'
import { z } from 'zod'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Route, defineResource, when } from '../../src/index'
import type { Ctx, MissingValue, VerifyController } from '../../src/index'

class User {
  declare readonly id: number
  declare readonly name: string
  declare readonly email: string
  declare readonly isAdmin: boolean
  declare readonly createdAt: Date
}
class Post { declare readonly id: number; declare readonly title: string }

const PostResource = defineResource(Post, (post) => ({ id: post.id, title: post.title }))
const UserResource = defineResource(User, (user) => ({
  id: user.id,
  name: user.name,
  email: when(user.isAdmin, user.email),
  createdAt: user.createdAt,
}))

type UserOut = { id: number; name: string; email?: string; createdAt: Date }

describe('the inferred output', () => {
  test('is the data fn returns, with when() keys optional', () => {
    expectTypeOf(UserResource.make).returns.toEqualTypeOf<UserOut>()
    expectTypeOf(UserResource.collection).returns.toEqualTypeOf<UserOut[]>()
  })

  test('when() with a function value gives what it returns, and a function is called, never kept', () => {
    expectTypeOf(when(true, () => 1)).toEqualTypeOf<number | MissingValue>()
    expectTypeOf(when(true, 'a' as const)).toEqualTypeOf<'a' | MissingValue>()
    const Lazy = defineResource(User, (user) => ({ secret: when(user.isAdmin, () => user.email) }))
    expectTypeOf(Lazy.make).returns.toEqualTypeOf<{ secret?: string }>()
  })

  test('readonly keys stay readonly; an any key stays required', () => {
    const R = defineResource(User, (user) => ({ id: user.id, raw: user as any }) as { readonly id: number; raw: any })
    expectTypeOf(R.make).returns.toEqualTypeOf<{ readonly id: number; raw: any }>()
  })

  test('a nested resource gives its own output', () => {
    const WithPosts = defineResource(User, (user) => ({ id: user.id, posts: PostResource.collection([] as Post[]) }))
    expectTypeOf(WithPosts.make).returns.toEqualTypeOf<{ id: number; posts: { id: number; title: string }[] }>()
  })

  test('paginate maps data and keeps the meta fields of the page', () => {
    const page = UserResource.paginate({ data: [] as User[], total: 0, perPage: 15 })
    expectTypeOf(page).toEqualTypeOf<{ total: number; perPage: number; data: UserOut[] }>()
  })

  test('make, collection and paginate take the model, and fn returns an object', () => {
    // @ts-expect-error a Post is not a User
    UserResource.make(new Post())
    // @ts-expect-error a Post is not a User
    UserResource.collection([new Post()])
    // @ts-expect-error a page needs data
    UserResource.paginate({ total: 0 })
    // @ts-expect-error a resource maps to an object, not an array
    defineResource(User, (user) => [user.id])
    // @ts-expect-error fn is synchronous: load relations before make()
    defineResource(User, async (user) => ({ id: user.id }))
  })
})

// ---- checked against the contract -------------------------------------------

const UserDto = z.object({ id: z.number(), name: z.string(), email: z.string().optional(), createdAt: z.date() })
const users = defineContract()({
  index: endpoint.get('/').response(z.array(UserDto)),
  show: endpoint.get('/:id').response(UserDto),
  page: endpoint.get('/page').response(z.object({ data: z.array(UserDto), total: z.number() })),
})
const appApi = defineApi({ users: { contract: users, path: '/api/users', scopes: [], dirs: [] } })

class UserController extends Controller {
  index() { return UserResource.collection([] as User[]) }
  async show(ctx: Ctx<typeof users.show>) { return UserResource.make(ctx.endpoint as unknown as User) }
  page() { return UserResource.paginate({ data: [] as User[], total: 0 }) }
}

type With<H extends object> = Omit<UserController, keyof H> & H
type Proof<I> = VerifyController<'users', typeof users, '/api/users', I>

describe('checked against the contract response schema', () => {
  test('a resource that satisfies the schema passes, by make, collection and paginate', () => {
    Route.api(appApi, (r) => [r.contract(users, UserController)])
    expectTypeOf<Proof<UserController>>().toEqualTypeOf<unknown>()
  })

  test('a when() key where the schema requires it', () => {
    const Strict = z.object({ id: z.number(), email: z.string() })
    const strict = defineContract()({ show: endpoint.get('/').response(Strict) })
    const Emails = defineResource(User, (user) => ({ id: user.id, email: when(user.isAdmin, user.email) }))
    class Ctrl extends Controller { show() { return Emails.make({} as User) } }
    type P = VerifyController<'strict', typeof strict, '/', Ctrl>
    expectTypeOf<P>().toHaveProperty('strict.show: return type does not match the response schema')
    expectTypeOf<P['strict.show: return type does not match the response schema']['got']>().toEqualTypeOf<{ id: number; email?: string }>()
  })

  test('a wrong value type, a missing key, a single resource for a list', () => {
    const WrongId = defineResource(User, (user) => ({ id: String(user.id), name: user.name, createdAt: user.createdAt }))
    expectTypeOf<Proof<With<{ show(): ReturnType<typeof WrongId.make> }>>>().toHaveProperty('users.show: return type does not match the response schema')
    const NoName = defineResource(User, (user) => ({ id: user.id, createdAt: user.createdAt }))
    expectTypeOf<Proof<With<{ show(): ReturnType<typeof NoName.make> }>>>().toHaveProperty('users.show: return type does not match the response schema')
    expectTypeOf<Proof<With<{ index(): ReturnType<typeof UserResource.make> }>>>().toHaveProperty('users.index: return type does not match the response schema')
    expectTypeOf<Proof<With<{ page(): ReturnType<typeof UserResource.collection> }>>>().toHaveProperty('users.page: return type does not match the response schema')
  })

  test('a mismatch is reported at r.contract()', () => {
    const NoName = defineResource(User, (user) => ({ id: user.id, createdAt: user.createdAt }))
    class Wrong extends Controller {
      index() { return NoName.collection([] as User[]) }
      show() { return UserResource.make({} as User) }
      page() { return UserResource.paginate({ data: [] as User[], total: 0 }) }
    }
    // @ts-expect-error users.index: return type does not match the response schema
    Route.api(appApi, (r) => [r.contract(users, Wrong)])
  })
})
