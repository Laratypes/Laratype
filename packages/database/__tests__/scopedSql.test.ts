// H14 #163: the scoped lookup's SQL, with real TypeORM metadata (docs/v1/database.md › BindableModel). No database:
// `buildMetadatas()` gives the entities their relation/join-column metadata, and the `findOne` stub records the query
// `findOne` would run, so the relation-property form used by `scopeConditions` is proven to become a join-column filter.
import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DataSource, EntitySchema } from 'typeorm'
import { format } from 'mysql2'
import Model from '../src/eloquent/Model'

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
    entities: [userSchema, postSchema],
    synchronize: false,
  })
  // No connect: metadata only (the protected method the CLI/ORM uses internally)
  await (dataSource as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas()

  const repository = dataSource.getRepository(RtPost)
  const findOne = async (options: unknown) => {
    const builder = repository.createQueryBuilder('rtPost').setFindOptions(options as never)
    const [sql, parameters] = builder.getQueryAndParameters()
    queries.push({ sql, parameters })
    return null
  }
  ;[RtPost, RtUser].forEach((entity) => {
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
})
