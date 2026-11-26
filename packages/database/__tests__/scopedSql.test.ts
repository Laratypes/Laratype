// H14 #163: the scoped lookup's SQL, with real TypeORM metadata (docs/v1/database.md › BindableModel). No database:
// `buildMetadatas()` gives the entities their relation/join-column metadata, and the `findOne` stub records the query
// `findOne` would run, so the relation-property form used by `scopeConditions` is proven to become a join-column filter.
import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DataSource, EntitySchema } from 'typeorm'
import { format } from 'mysql2'
import Model from '../src/eloquent/Model'
import ModelError from '../src/exceptions/ModelError'

class RtUser extends Model {
  declare id: number
  declare name: string
}

class RtPost extends Model {
  static override readonly routeKeyName = 'slug'
  declare id: number
  declare slug: string
  declare title: string
  /** The relation's join column: TypeORM maps `where: { user: ... }` to this database column. */
  declare user: RtUser
}

/** A parent whose route key is unique over `(tenantId, code)`, the composite relation case (H14 #420 CR). */
class RtTenant extends Model {
  declare id: number
  declare tenantId: number
  declare code: string
}

class RtTenantPost extends Model {
  static override readonly routeKeyName = 'slug'
  declare id: number
  declare slug: string
  declare tenantId: number
  declare code: string
  declare parent: RtTenant
}

/** A relation declared inside an embedded class: TypeORM stores it at `ownership.user`, not `user` (H14 #420 CR). */
class RtOwnership {
  declare user: RtUser
}

class RtOwner extends Model {
  static override readonly routeKeyName = 'slug'
  declare id: number
  declare slug: string
  declare ownership: RtOwnership
}

class RtProtoChild extends Model {
  static override readonly routeKeyName = 'slug'
  declare id: number
  declare slug: string
  declare tenant: RtTenant
  declare user: RtUser
}

const userSchema = new EntitySchema({
  name: 'RtUser',
  target: RtUser,
  columns: {
    id: { type: Number, primary: true },
    name: { type: String },
  },
  relations: {
    // A real one-to-many: the non-owning side, refused as a scoped relation
    posts: { type: 'one-to-many', target: 'RtPost', inverseSide: 'user' },
  },
})

const postSchema = new EntitySchema({
  name: 'RtPost',
  target: RtPost,
  columns: {
    id: { type: Number, primary: true },
    slug: { type: String },
    title: { type: String },
  },
  relations: {
    user: { type: 'many-to-one', target: 'RtUser', joinColumn: { name: 'userId', referencedColumnName: 'id' } },
  },
})

const tenantSchema = new EntitySchema({
  name: 'RtTenant',
  target: RtTenant,
  columns: {
    id: { type: Number, primary: true },
    tenantId: { type: Number },
    code: { type: String },
  },
  uniques: [{ columns: ['tenantId', 'code'] }],
})

const tenantPostSchema = new EntitySchema({
  name: 'RtTenantPost',
  target: RtTenantPost,
  columns: {
    id: { type: Number, primary: true },
    slug: { type: String },
    tenantId: { type: Number },
    code: { type: String },
  },
  relations: {
    // Two join columns: `tenantId` alone does not identify the parent
    parent: {
      type: 'many-to-one',
      target: 'RtTenant',
      joinColumn: [
        { name: 'tenantId', referencedColumnName: 'tenantId' },
        { name: 'code', referencedColumnName: 'code' },
      ],
    },
  },
})

const ownershipSchema = new EntitySchema({
  name: 'RtOwnership',
  columns: {
    id: { type: Number, primary: true },
  },
  relations: {
    user: { type: 'many-to-one', target: 'RtUser', joinColumn: { name: 'userId', referencedColumnName: 'id' } },
  },
})

const ownerSchema = new EntitySchema({
  name: 'RtOwner',
  target: RtOwner,
  columns: {
    id: { type: Number, primary: true },
    slug: { type: String },
  },
  embeddeds: {
    ownership: { schema: ownershipSchema, prefix: 'own' },
  },
})

const protoChildSchema = new EntitySchema({
  name: 'RtProtoChild',
  target: RtProtoChild,
  columns: {
    id: { type: Number, primary: true },
    slug: { type: String },
  },
  relations: {
    // A relation named `__proto__` next to an ordinary one, from real metadata (H14 #420 CR)
    ['__proto__']: { type: 'many-to-one', target: 'RtTenant', joinColumn: { name: 'protoTenantId', referencedColumnName: 'id' } },
    user: { type: 'many-to-one', target: 'RtUser', joinColumn: { name: 'userId', referencedColumnName: 'id' } },
  },
})

interface RecordedQuery {
  readonly sql: string
  readonly parameters: unknown[]
}

let dataSource: DataSource
const queries: RecordedQuery[] = []

beforeAll(async () => {
  dataSource = new DataSource({
    type: 'mysql',
    host: 'localhost',
    username: 'bench',
    database: 'bench',
    entities: [userSchema, postSchema, tenantSchema, tenantPostSchema, ownershipSchema, ownerSchema, protoChildSchema],
    synchronize: false,
  })
  // No connect: metadata only (the protected method the CLI/ORM uses internally)
  await (dataSource as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas()

  // One `findOne` stub per entity: the repository's own metadata resolves the where keys, and the alias stays `rtPost`
  ;[RtPost, RtUser, RtTenantPost, RtTenant, RtOwner, RtProtoChild].forEach((entity) => {
    const repository = dataSource.getRepository(entity)
    const findOne = async (options: unknown) => {
      const builder = repository.createQueryBuilder('rtPost').setFindOptions(options as never)
      const [sql, parameters] = builder.getQueryAndParameters()
      queries.push({ sql, parameters })
      return null
    }
    ;(entity as unknown as { getRepository: () => unknown }).getRepository = () => ({
      metadata: dataSource.getMetadata(entity),
      manager: repository.manager,
      findOne,
    })
  })
})

afterAll(async () => {
  if (dataSource?.isInitialized) await dataSource.destroy()
})

describe('Model.findByRouteKey scoped SQL (H14 #163)', () => {
  it('filters the join column of the post table with the parent id, both as parameters', async () => {
    queries.length = 0
    const user = Object.assign(new RtUser(), { id: 7 })
    await expect(RtPost.findByRouteKey('hello', { user })).resolves.toBeNull()
    expect(queries).toHaveLength(1)
    const [{ sql, parameters }] = queries as [RecordedQuery]
    // The route key and the relation's join column are both conditions on the post table
    expect(sql).toContain('`rtPost`.`slug` = ?')
    expect(sql).toContain('`rtPost`.`userId` = ?')
    expect(parameters).toEqual(['hello', 7])
  })

  it('binds a hostile parent id as one quoted literal: no object injection', async () => {
    queries.length = 0
    const hostile = "7' OR '1'='1"
    const user = Object.assign(new RtUser(), { id: hostile })
    await RtPost.findByRouteKey('hello', { user })
    const [{ sql, parameters }] = queries as [RecordedQuery]
    expect(parameters).toEqual(['hello', hostile])
    const formatted = format(sql, parameters)
    // mysql2 escapes the whole value into one literal: the injected OR stays inside the quotes
    expect(formatted).toContain("`rtPost`.`userId` = '7\\' OR \\'1\\'=\\'1'")
    expect(formatted).not.toContain("= 7' OR '1'='1'")
  })

  it('refuses a real one-to-many relation before any query', async () => {
    // RtUser.posts is a one-to-many: its join column is on the post table, so it cannot filter the user's table
    queries.length = 0
    const post = Object.assign(new RtPost(), { id: 9, slug: 'hello' })
    await expect(RtUser.findByRouteKey('7', { post })).rejects.toThrow(
      '[@laratype/database] RtUser relation "posts" is not a many-to-one or an owning one-to-one relation: .scopeBindings() needs the side that holds the join column',
    )
    expect(queries).toHaveLength(0)
  })

  it('refuses a composite relation before any query: two parents sharing the first component cannot scope it', async () => {
    queries.length = 0
    // The parent is unique over (tenantId, code): filtering tenantId alone would let one tenant's code answer the other
    const tenantA = Object.assign(new RtTenant(), { id: 1, tenantId: 7, code: 'A' })
    const tenantB = Object.assign(new RtTenant(), { id: 2, tenantId: 7, code: 'B' })
    for (const parent of [tenantA, tenantB]) {
      const failure = await RtTenantPost.findByRouteKey('hello', { parent }).catch((error: unknown) => error)
      expect(failure, `${parent.code}`).toBeInstanceOf(ModelError)
      expect((failure as ModelError).message).toBe(
        '[@laratype/database] RtTenantPost relation "parent" has a composite join column: .scopeBindings() needs a single-column relation',
      )
    }
    expect(queries).toHaveLength(0)
    // The single-column case keeps scoping the lookup
    await RtPost.findByRouteKey('hello', { user: Object.assign(new RtUser(), { id: 7 }) })
    expect(queries).toHaveLength(1)
    expect(queries[0]!.sql).toContain('`rtPost`.`userId` = ?')
  })

  it('refuses a relation declared inside an embedded before any query', async () => {
    // RtOwner's relation is `ownership.user`: `join.propertyName` is only `user`, which TypeORM's find options reject
    queries.length = 0
    const failure = await RtOwner.findByRouteKey('hello', { user: Object.assign(new RtUser(), { id: 7 }) }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ModelError)
    expect((failure as ModelError).message).toBe(
      '[@laratype/database] RtOwner relation "user" is declared inside the embedded "ownership": .scopeBindings() needs a relation on the model itself',
    )
    expect(queries).toHaveLength(0)
  })

  it('refuses a __proto__ relation, and keeps an ordinary relation on the same model scoped', async () => {
    queries.length = 0
    const tenant = Object.assign(new RtTenant(), { id: 1, tenantId: 7, code: 'A' })
    const failure = await RtProtoChild.findByRouteKey('hello', { tenant }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ModelError)
    expect((failure as ModelError).message).toBe(
      '[@laratype/database] RtProtoChild relation `__proto__` cannot scope a lookup: every object reads it as its prototype, so the condition would be dropped',
    )
    expect(queries).toHaveLength(0)
    // The ordinary relation still becomes a condition on the join column
    await RtProtoChild.findByRouteKey('hello', { user: Object.assign(new RtUser(), { id: 7 }) })
    expect(queries).toHaveLength(1)
    expect(queries[0]!.sql).toContain('`rtPost`.`userId` = ?')
    expect(queries[0]!.parameters).toEqual(['hello', 7])
  })
})