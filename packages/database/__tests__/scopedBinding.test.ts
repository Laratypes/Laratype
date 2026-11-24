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
const parentModel = (options: { transformer?: AppTransformer } = {}) => {
  class User extends Model {
    declare id: number
  }
  ;(User as any).getRepository = () => ({
    metadata: {
      targetName: 'User',
      primaryColumns: [{ propertyName: 'id' }],
      columns: [{ propertyName: 'id', propertyPath: 'id', type: Number, transformer: options.transformer }],
      relations: [],
    },
    manager: { connection: { driver: { options: { type: 'mysql' } } } },
    findOne: async () => ({ id: 7 }),
  })
  return User
}

interface FakeRelation {
  readonly propertyName: string
  readonly inverseEntityMetadata: { readonly target: unknown }
  readonly isManyToOne?: boolean
  readonly isOneToOneOwner?: boolean
  readonly isOneToMany?: boolean
  readonly joinColumns?: readonly { readonly propertyName: string; readonly referencedColumn?: { readonly propertyName: string } }[]
}

/** A child model (`Post`) whose `user` relation joins on `userId`, with the parent class the scope passes. */
const postModel = (options: { relations?: FakeRelation[]; routeKeyName?: string; transformer?: AppTransformer; targetName?: string } = {}) => {
  class Post extends Model {
    declare id: number
    declare slug: string
    declare userId: number
  }
  const targetName = options.targetName ?? 'Post'
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
      targetName,
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

const userRelation = (
  parent: unknown,
  referenced: { readonly propertyName: string; readonly transformer?: AppTransformer } = { propertyName: 'id' },
): FakeRelation => ({
  propertyName: 'user',
  inverseEntityMetadata: { target: parent },
  isManyToOne: true,
  joinColumns: [{ propertyName: 'userId', referencedColumn: referenced }],
})

const postRelation = (
  parent: unknown,
  referenced: { readonly propertyName: string } = { propertyName: 'id' },
): FakeRelation => ({
  propertyName: 'post',
  inverseEntityMetadata: { target: parent },
  isManyToOne: true,
  joinColumns: [{ propertyName: 'postId', referencedColumn: referenced }],
})
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

  it('converts the parent value through the referenced column transformer, and refuses a throwing or non-scalar one', async () => {
    const prefix = { to: (value: unknown) => `u-${String(value)}`, from: (value: unknown) => Number(String(value).replace('u-', '')) }
    const User = parentModel({ transformer: prefix })
    const { Post, calls } = postModel({ relations: [userRelation(User, { propertyName: 'id', transformer: prefix })] })
    await Post.findByRouteKey('hello', { user: Object.assign(new User(), { id: 7 }) })
    expect(rawOf(calls[0]!.where.userId).objectLiteralParameters).toEqual({ scope0: 'u-7' })

    const throwing = parentModel({ transformer: { to: () => { throw new Error('boom') }, from: (value: unknown) => value } })
    const throwingPost = postModel({ relations: [userRelation(throwing, { propertyName: 'id', transformer: { to: () => { throw new Error('boom') }, from: (value: unknown) => value } })] })
    await expect(throwingPost.Post.findByRouteKey('hello', { user: Object.assign(new throwing(), { id: 7 }) })).rejects.toThrow(
      '[@laratype/database] Post relation "user" references a column whose transformer.to() throws on the parent value: .scopeBindings() cannot bind the parent key',
    )

    const toObject = { to: () => ({ id: 7 }), from: (value: unknown) => value }
    const objectParent = parentModel({ transformer: toObject })
    const objectPost = postModel({ relations: [userRelation(objectParent, { propertyName: 'id', transformer: toObject })] })
    await expect(objectPost.Post.findByRouteKey('hello', { user: Object.assign(new objectParent(), { id: 7 }) })).rejects.toThrow(
      'so it cannot scope a lookup',
    )
  })

  it('scopes through the relation to the actual parent, not the first relation it has', async () => {
    class Category {
      declare id: number
    }
    const User = parentModel()
    const { Post, calls } = postModel({
      relations: [
        { propertyName: 'category', inverseEntityMetadata: { target: Category }, joinColumns: [{ propertyName: 'categoryId', referencedColumn: { propertyName: 'id' } }] },
        userRelation(User),
      ],
    })
    await Post.findByRouteKey('hello', { user: Object.assign(new User(), { id: 7 }) })
    const where = calls[0]!.where
    // The category relation is unrelated: only the user relation's join column is filtered
    expect(where.categoryId).toBeUndefined()
    expect(rawOf(where.userId).objectLiteralParameters).toEqual({ scope0: 7 })
  })

  it('a parent value it cannot read is a configuration error, not SQL', async () => {
    const User = parentModel()
    const { Post, calls } = postModel({ relations: [userRelation(User)] })
    const user = new User()
    Object.defineProperty(user, 'id', { get: () => { throw new Error('boom') } })
    await expect(Post.findByRouteKey('hello', { user })).rejects.toThrow(
      '[@laratype/database] Post is scoped by User."id", which the parent instance could not read: .scopeBindings() cannot bind the parent key',
    )
    expect(calls).toEqual([])
  })

  it('refuses a route key that is also the relation join column', async () => {
    const User = parentModel()
    const { Post } = postModel({ routeKeyName: 'userId', relations: [userRelation(User)] })
    await expect(Post.findByRouteKey('7', { user: Object.assign(new User(), { id: 7 }) })).rejects.toThrow(
      '[@laratype/database] Post route key "userId" is also the relation\'s join column: .scopeBindings() cannot scope the lookup by it',
    )
  })

  it('a three-level scope needs a relation only to the immediate parent', async () => {
    class Post {
      declare id: number
    }
    const User = parentModel()
    // Comment relates only to Post: the earlier `user` is transitive and adds no condition
    const { Post: Comment, calls } = postModel({ targetName: 'Comment', relations: [postRelation(Post)] })
    const user = Object.assign(new User(), { id: 7 })
    const post = Object.assign(new Post(), { id: 9 })
    await Comment.findByRouteKey('c1', { user, post })
    const where = calls[0]!.where
    expect(where.userId).toBeUndefined()
    expect(rawOf(where.postId).objectLiteralParameters).toEqual({ scope0: 9 })
  })

  it('adds a condition for every parent the model relates to', async () => {
    class Post {
      declare id: number
    }
    const User = parentModel()
    const { Post: Comment, calls } = postModel({ targetName: 'Comment', relations: [userRelation(User), postRelation(Post)] })
    await Comment.findByRouteKey('c1', {
      user: Object.assign(new User(), { id: 7 }),
      post: Object.assign(new Post(), { id: 9 }),
    })
    const where = calls[0]!.where
    expect(rawOf(where.userId).objectLiteralParameters).toEqual({ scope0: 7 })
    expect(rawOf(where.postId).objectLiteralParameters).toEqual({ scope1: 9 })
  })

  it('refuses more than one relation to the same parent: the scope cannot choose one', async () => {
    const User = parentModel()
    const author = { ...userRelation(User), propertyName: 'author' }
    const editor = { ...userRelation(User), propertyName: 'editor' }
    const { Post } = postModel({ relations: [author, editor] })
    await expect(Post.findByRouteKey('hello', { user: Object.assign(new User(), { id: 7 }) })).rejects.toThrow(
      '[@laratype/database] Post has 2 relations to User (author, editor): .scopeBindings() cannot choose one; keep a single relation to User',
    )
  })

  it('refuses a relation that is not many-to-one or an owning one-to-one', async () => {
    const User = parentModel()
    const members: FakeRelation = { propertyName: 'members', inverseEntityMetadata: { target: User }, isOneToMany: true, joinColumns: [] }
    const oneToMany = postModel({ relations: [members] })
    await expect(oneToMany.Post.findByRouteKey('hello', { user: Object.assign(new User(), { id: 7 }) })).rejects.toThrow(
      '[@laratype/database] Post relation "members" is not a many-to-one or an owning one-to-one relation: .scopeBindings() needs the side that holds the join column',
    )
    const inverse: FakeRelation = {
      propertyName: 'account',
      inverseEntityMetadata: { target: User },
      isOneToOneOwner: false,
      joinColumns: [{ propertyName: 'userId', referencedColumn: { propertyName: 'id' } }],
    }
    const notOwner = postModel({ relations: [inverse] })
    await expect(notOwner.Post.findByRouteKey('hello', { user: Object.assign(new User(), { id: 7 }) })).rejects.toThrow(
      'is not a many-to-one or an owning one-to-one relation',
    )
  })

  it('ignores an earlier parent with no single usable relation (transitive)', async () => {
    const User = parentModel()
    class Post {
      declare id: number
    }
    // Two relations to the earlier user: it is optional, so the scope skips it rather than choosing one
    const author = { ...userRelation(User), propertyName: 'author' }
    const editor = { ...userRelation(User), propertyName: 'editor' }
    const { Post: Comment, calls } = postModel({ targetName: 'Comment', relations: [author, editor, postRelation(Post)] })
    await Comment.findByRouteKey('c1', {
      user: Object.assign(new User(), { id: 7 }),
      post: Object.assign(new Post(), { id: 9 }),
    })
    const where = calls[0]!.where
    expect(where.userId).toBeUndefined()
    expect(rawOf(where.postId).objectLiteralParameters).toEqual({ scope0: 9 })
  })

  it('counts only relations that can hold a join column for the ambiguity check', async () => {
    class Node {
      declare id: number
    }
    // A self-referencing tree: `parent` is many-to-one, `children` one-to-many. Only `parent` can scope the lookup.
    const parent = postRelation(Node)
    const children: FakeRelation = { propertyName: 'children', inverseEntityMetadata: { target: Node }, isOneToMany: true, joinColumns: [] }
    const { Post: Comment, calls } = postModel({ targetName: 'Node', relations: [parent, children] })
    await Comment.findByRouteKey('c1', { post: Object.assign(new Node(), { id: 9 }) })
    expect(rawOf(calls[0]!.where.postId).objectLiteralParameters).toEqual({ scope0: 9 })
  })

  it('refuses two parents that filter the same join column', async () => {
    const User = parentModel()
    class Admin {
      declare id: number
    }
    const admin: FakeRelation = {
      propertyName: 'admin',
      inverseEntityMetadata: { target: Admin },
      isManyToOne: true,
      joinColumns: [{ propertyName: 'userId', referencedColumn: { propertyName: 'id' } }],
    }
    const { Post } = postModel({ relations: [userRelation(User), admin] })
    await expect(
      Post.findByRouteKey('hello', {
        user: Object.assign(new User(), { id: 7 }),
        admin: Object.assign(new Admin(), { id: 8 }),
      }),
    ).rejects.toThrow('[@laratype/database] Post: two scoped parents filter the join column "userId": .scopeBindings() cannot filter it for both')
  })

  it('refuses a model with no relation to the parent, and a relation with no join column', async () => {
    const User = parentModel()
    const unrelated = postModel()
    await expect(unrelated.Post.findByRouteKey('hello', { user: Object.assign(new User(), { id: 7 }) })).rejects.toThrow(
      '[@laratype/database] Post has no relation to User: .scopeBindings() scopes a child lookup through a relation whose target is the parent model',
    )
    const noJoin = postModel({ relations: [{ propertyName: 'user', inverseEntityMetadata: { target: User }, isManyToOne: true }] })
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
