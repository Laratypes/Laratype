// H14 #163: scoped route bindings (docs/v1/database.md › BindableModel, docs/v1/http.md › Model binding). The relation
// metadata is stubbed over the TypeORM shape, as Model.statics.test.ts does; no database is needed.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { format } from 'mysql2'
import { FindOperator } from 'typeorm'
import Model from '../src/eloquent/Model'
import ModelError from '../src/exceptions/ModelError'

type Row = Record<string, unknown>

/** A parent model (`User`) whose repository answers a row, so the base statics can be read. */
const parentModel = () => {
  class User extends Model {
    declare id: number
  }
  ;(User as any).getRepository = () => ({
    metadata: { targetName: 'User', primaryColumns: [{ propertyName: 'id' }], columns: [{ propertyName: 'id', propertyPath: 'id', type: Number }], relations: [] },
    manager: { connection: { driver: { options: { type: 'mysql' } } } },
    findOne: async () => ({ id: 7 }),
  })
  return User
}

interface FakeRelation {
  readonly propertyName: string
  readonly inverseEntityMetadata: { readonly target: unknown }
  readonly joinColumns?: readonly { readonly propertyName: string; readonly referencedColumn?: { readonly propertyName: string } }[]
}

/** A child model (`Post`) whose `user` relation joins on `userId`, with the parent class the scope passes. */
const postModel = (options: { relations?: FakeRelation[]; routeKeyName?: string; transformer?: AppTransformer } = {}) => {
  class Post extends Model {
    declare id: number
    declare slug: string
    declare userId: number
  }
  Object.defineProperty(Post, 'routeKeyName', { value: options.routeKeyName ?? 'slug' })
  const calls: { where: Row }[] = []
  const columns: Row[] = [
    { propertyName: 'id', propertyPath: 'id', type: Number },
    { propertyName: 'slug', propertyPath: 'slug', type: String },
    { propertyName: 'userId', propertyPath: 'userId', type: Number },
  ]
  if (options.transformer !== undefined) {
    ;(columns[1] as Row).transformer = options.transformer
  }
  ;(Post as any).getRepository = () => ({
    metadata: {
      targetName: 'Post',
      primaryColumns: [{ propertyName: 'id' }],
      columns,
      relations: options.relations ?? [],
    },
    manager: { connection: { driver: { options: { type: 'mysql' } } } },
    findOne: async (call: { where: Row }) => {
      calls.push(call)
      return { id: 1, slug: 'hello', userId: 7 }
    },
  })
  return { Post, calls }
}

interface AppTransformer {
  to(value: unknown): unknown
  from(value: unknown): unknown
}

const userRelation = (parent: unknown): FakeRelation => ({
  propertyName: 'user',
  inverseEntityMetadata: { target: parent },
  joinColumns: [{ propertyName: 'userId', referencedColumn: { propertyName: 'id' } }],
})

/** The raw condition of a `where` value, for the SQL/parameter assertions (D9). */
const rawOf = (value: unknown) => {
  if (!(value instanceof FindOperator)) throw new Error('not a FindOperator');
  return value
}

describe('Model.findByRouteKey scope (H14 #163)', () => {
  it('takes the scope as a plain second parameter, which is what a scoped route checks', () => {
    expect(Model.findByRouteKey.length).toBe(2)
  })

  it('filters through the relation join column, bound as one parameter', async () => {
    const User = parentModel()
    const { Post, calls } = postModel({ relations: [userRelation(User)] })
    const user = Object.assign(new User(), { id: 7 })
    await expect(Post.findByRouteKey('hello', { user })).resolves.toMatchObject({ slug: 'hello' })
    const where = calls[0]!.where
    // The route key keeps the Raw form, and the scope is a Raw condition on the join column
    const scope = rawOf(where.userId)
    expect(scope.type).toBe('raw')
    // The generator only appends the named placeholder: the parent value is never SQL text
    expect(scope.getSql!('post.userId')).toBe('post.userId = :scope0')
    expect(scope.objectLiteralParameters).toEqual({ scope0: 7 })
    // D9: the value reaches the driver as one bound primitive, never as SQL text or an object where-value
    expect(format('SELECT * FROM `posts` WHERE `user_id` = ?', [scope.objectLiteralParameters!.scope0])).toBe(
      'SELECT * FROM `posts` WHERE `user_id` = 7',
    )
    expect(rawOf(where.slug).objectLiteralParameters).toEqual({ routeKey: 'hello' })
  })

  it('scopes a transformed route key through the same raw parameters', async () => {
    const User = parentModel()
    const { Post, calls } = postModel({
      relations: [userRelation(User)],
      transformer: { to: (value: unknown) => Number(String(value).replace('item-', '')), from: (value: unknown) => `item-${String(value)}` },
    })
    await Post.findByRouteKey('item-2', { user: Object.assign(new User(), { id: 7 }) })
    const where = calls[0]!.where
    expect(rawOf(where.slug).objectLiteralParameters).toEqual({ routeKey: 2 })
    expect(rawOf(where.userId).objectLiteralParameters).toEqual({ scope0: 7 })
  })

  it('answers null for a null parent key: no child references nothing', async () => {
    const User = parentModel()
    const { Post, calls } = postModel({ relations: [userRelation(User)] })
    await expect(Post.findByRouteKey('hello', { user: Object.assign(new User(), { id: null }) })).resolves.toBeNull()
    expect(calls).toEqual([])
  })

  it('refuses an object, array or toString-bearing parent key: it never becomes a where-value', async () => {
    const User = parentModel()
    const { Post, calls } = postModel({ relations: [userRelation(User)] })
    for (const id of [{ id: 7 }, [7], { toString: () => '1 OR 1=1' }, new Uint8Array([7]), NaN, Infinity]) {
      const failure = await Post.findByRouteKey('hello', { user: Object.assign(new User(), { id }) }).catch((error: unknown) => error)
      expect(failure, String(id)).toBeInstanceOf(ModelError)
      expect((failure as ModelError).message).toContain('so it cannot scope a lookup')
    }
    expect(calls).toEqual([])
  })

  it('refuses a parent column that is not loaded, and a scope value that is not a model', async () => {
    const User = parentModel()
    const { Post } = postModel({ relations: [userRelation(User)] })
    await expect(Post.findByRouteKey('hello', { user: new User() })).rejects.toThrow(
      '[@laratype/database] Post is scoped by User."id", which the parent instance has not loaded',
    )
    await expect(Post.findByRouteKey('hello', { user: null as never })).rejects.toThrow(
      '[@laratype/database] Post.findByRouteKey(): the scope `user` is not a model instance, got null',
    )
  })

  it('refuses a model with no relation to the parent, and a relation with no join column', async () => {
    const User = parentModel()
    const unrelated = postModel()
    await expect(unrelated.Post.findByRouteKey('hello', { user: Object.assign(new User(), { id: 7 }) })).rejects.toThrow(
      '[@laratype/database] Post has no relation to User: .scopeBindings() scopes a child lookup through a relation whose target is the parent model',
    )
    const noJoin = postModel({ relations: [{ propertyName: 'user', inverseEntityMetadata: { target: User } }] })
    await expect(noJoin.Post.findByRouteKey('hello', { user: Object.assign(new User(), { id: 7 }) })).rejects.toThrow(
      '[@laratype/database] Post relation "user" has no join column: .scopeBindings() needs the owning side of a relation to the parent',
    )
  })

  it('an empty scope keeps the plain lookup, and an unscoped call never touches a relation', async () => {
    const User = parentModel()
    const { Post, calls } = postModel({ relations: [userRelation(User)] })
    await Post.findByRouteKey('hello')
    await Post.findByRouteKey('hello', {})
    expect(calls.map((call) => Object.keys(call.where))).toEqual([['slug'], ['slug']])
  })
})
