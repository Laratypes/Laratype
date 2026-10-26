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

const user = () => ({}) as User

type UserOut = { id: number; name: string; email?: string; createdAt: Date }

describe('the inferred output', () => {
  test('is the data fn returns, with when() keys optional', () => {
    expectTypeOf(UserResource.make).returns.toEqualTypeOf<UserOut>()
    expectTypeOf(UserResource.collection).returns.toEqualTypeOf<UserOut[]>()
  })

  test('when() gives the value type: a function is kept, never called', () => {
    expectTypeOf(when(true, user().email)).toEqualTypeOf<string | MissingValue>()
    const format = (id: number) => String(id)
    const Fn = defineResource(User, (user) => ({ format: when(user.isAdmin, format) }))
    expectTypeOf(Fn.make).returns.toEqualTypeOf<{ format?: (id: number) => string }>()
  })

  test('when() refuses an any or unknown value, whose key would look required', () => {
    // @ts-expect-error V | MissingValue would be any
    when(true, {} as any)
    // @ts-expect-error V | MissingValue would be unknown
    when(true, {} as unknown)
  })

  test('readonly keys stay readonly; any, unknown and object keys stay required', () => {
    const R = defineResource(User, (user) => ({ id: user.id, raw: user as any, meta: {} as unknown, tags: {} as object }) as {
      readonly id: number; raw: any; meta: unknown; tags: object
    })
    expectTypeOf(R.make).returns.toEqualTypeOf<{ readonly id: number; raw: any; meta: unknown; tags: object }>()
  })

  test('fn may be typed with an interface', () => {
    interface UserDto { id: number }
    expectTypeOf(defineResource(User, (user): UserDto => ({ id: user.id })).make).returns.toEqualTypeOf<{ id: number }>()
  })

  test('a nested resource gives its own output', () => {
    const WithPosts = defineResource(User, (user) => ({ id: user.id, posts: PostResource.collection([] as Post[]) }))
    expectTypeOf(WithPosts.make).returns.toEqualTypeOf<{ id: number; posts: { id: number; title: string }[] }>()
  })

  test('paginate maps data and keeps the meta fields of the page, for each member of a union', () => {
    const page = UserResource.paginate({ data: [] as User[], total: 0, perPage: 15 })
    expectTypeOf(page).toEqualTypeOf<{ total: number; perPage: number; data: UserOut[] }>()
    type Page = { data: User[]; total: number } | { data: User[]; cursor: string }
    expectTypeOf(UserResource.paginate({} as Page)).toEqualTypeOf<{ total: number; data: UserOut[] } | { cursor: string; data: UserOut[] }>()
  })

  test('a union return gives one output per member, and narrows', () => {
    // An annotated union, so R is exactly its two members (an inferred ternary adds `?: undefined` keys to each one)
    type KindData = { kind: 'admin'; email: string | MissingValue } | { kind: 'member'; name: string | MissingValue }
    const Kind = defineResource(User, (user): KindData =>
      user.isAdmin
        ? { kind: 'admin', email: when(user.isAdmin, user.email) }
        : { kind: 'member', name: when(!user.isAdmin, user.name) })
    expectTypeOf(Kind.make).returns.toEqualTypeOf<
      { kind: 'admin'; email?: string } | { kind: 'member'; name?: string }
    >()
    const out = Kind.make(user())
    if (out.kind === 'admin') {
      expectTypeOf(out.email).toEqualTypeOf<string | undefined>()
      // @ts-expect-error the member's output has no name
      out.name
    } else {
      expectTypeOf(out.name).toEqualTypeOf<string | undefined>()
    }

    // The same as an inferred ternary: one output per member, the two key sets never cross
    const Inferred = defineResource(User, (user) =>
      user.isAdmin
        ? { kind: 'admin' as const, email: when(user.isAdmin, user.email) }
        : { kind: 'member' as const, id: user.id })
    const data = Inferred.make(user())
    if (data.kind === 'admin') expectTypeOf(data.email).toEqualTypeOf<string | undefined>()
    else expectTypeOf(data.id).toEqualTypeOf<number>()
  })

  test('a single object is still one output', () => {
    expectTypeOf(PostResource.make).returns.toEqualTypeOf<{ id: number; title: string }>()
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
    // @ts-expect-error a then key would make the data a thenable
    defineResource(User, (user) => ({ then: user.createdAt }))
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

  test('a union output is checked against the response schema, per member', () => {
    const UserKindDto = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('admin'), email: z.string() }),
      z.object({ kind: z.literal('member'), id: z.number() }),
    ])
    const kinds = defineContract()({ show: endpoint.get('/').response(UserKindDto) })
    const Kind = defineResource(User, (user) =>
      user.isAdmin
        ? { kind: 'admin' as const, email: user.email }
        : { kind: 'member' as const, id: user.id })
    class KindCtrl extends Controller { show() { return Kind.make(user()) } }
    type P = VerifyController<'kinds', typeof kinds, '/', KindCtrl>
    expectTypeOf<P>().toEqualTypeOf<unknown>()

    const WrongKind = defineResource(User, (user) =>
      user.isAdmin
        ? { kind: 'admin' as const, email: user.email }
        : { kind: 'member' as const, id: String(user.id) })
    class WrongKindCtrl extends Controller { show() { return WrongKind.make(user()) } }
    type Q = VerifyController<'kinds', typeof kinds, '/', WrongKindCtrl>
    expectTypeOf<Q>().toHaveProperty('kinds.show: return type does not match the response schema')
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
    expectTypeOf<keyof Proof<Wrong>>().toEqualTypeOf<'users.index: return type does not match the response schema'>()
  })
})
