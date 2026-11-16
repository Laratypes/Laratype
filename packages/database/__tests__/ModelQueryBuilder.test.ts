// The typed query facade: typed columns, an operator allowlist mapped to FindOperators, a metadata column check, a
// runtime-checked direction / limit / page / perPage, and a plain page result (docs/v1/database.md › Model).
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import type { FindOperator, ObjectLiteral, Repository } from 'typeorm'
import ModelQueryBuilder from '../src/eloquent/ModelQueryBuilder'

type Row = Record<string, any>

/** The slice of a TypeORM SelectQueryBuilder the facade reaches, over arrays in memory, so the test needs no database. */
class FakeQueryBuilder {
  readonly alias = 'User'
  readonly wheres: ObjectLiteral[] = []
  readonly orderBys: [string, string][] = []
  readonly limits: number[] = []
  readonly offsets: number[] = []

  constructor(
    private readonly rows: Row[],
    private readonly total = rows.length,
  ) {}

  andWhere(where: ObjectLiteral) {
    this.wheres.push(where)
    return this
  }

  orderBy(sort: string, order: 'ASC' | 'DESC') {
    this.orderBys.push([sort, order])
    return this
  }

  limit(count: number) {
    this.limits.push(count)
    return this
  }

  offset(count: number) {
    this.offsets.push(count)
    return this
  }

  async getOne() {
    return this.rows[0] ?? null
  }

  async getMany() {
    return this.rows
  }

  async getManyAndCount() {
    return [this.rows, this.total] as [Row[], number]
  }
}

/** A model query over `rows`, with the entity metadata the facade resolves columns against. */
const builder = (rows: Row[] = [], total = rows.length) => {
  const columns = [
    { propertyName: 'id', propertyPath: 'id', type: Number },
    { propertyName: 'email', propertyPath: 'email', type: String },
    { propertyName: 'age', propertyPath: 'age', type: Number },
    { propertyName: 'isActive', propertyPath: 'isActive', type: Boolean },
    { propertyName: 'deletedAt', propertyPath: 'deletedAt', type: Date },
    // An embedded column: its leaf `street` is not an own model property
    { propertyName: 'street', propertyPath: 'address.street', type: String },
  ]
  const query = new FakeQueryBuilder(rows, total)
  const repository = {
    metadata: { targetName: 'User', columns },
    createQueryBuilder: () => query,
  } as unknown as Repository<Row>
  return { query, UserQuery: new ModelQueryBuilder<Row>(repository) }
}

/** The FindOperator a where object holds for its only column. */
const operator = (query: FakeQueryBuilder): FindOperator<unknown> => {
  const [where] = query.wheres
  if (where === undefined) throw new Error("the where() call did not reach the query builder")
  const value = Object.values(where)[0]
  if (value === undefined) throw new Error("the where() call set no column")
  return value as FindOperator<unknown>
}

describe('ModelQueryBuilder.where', () => {
  it('adds an equality condition for the two-argument form', () => {
    const { query, UserQuery } = builder()
    expect(UserQuery.where('email', 'ada@example.com')).toBe(UserQuery)
    expect(query.wheres).toEqual([{ email: 'ada@example.com' }])
  })

  it('adds every column of the object form in one condition', () => {
    const { query, UserQuery } = builder()
    UserQuery.where({ email: 'ada@example.com', isActive: true })
    expect(query.wheres).toEqual([{ email: 'ada@example.com', isActive: true }])
  })

  it('maps every comparison to its FindOperator, so the value is a parameter', () => {
    const cases = [
      ['=', 'equal'],
      ['!=', 'not'],
      ['<', 'lessThan'],
      ['<=', 'lessThanOrEqual'],
      ['>', 'moreThan'],
      ['>=', 'moreThanOrEqual'],
      ['like', 'like'],
      ['not like', 'not'],
    ] as const
    for (const [comparison, type] of cases) {
      const { query, UserQuery } = builder()
      UserQuery.where('age', comparison, 21)
      expect(operator(query).type).toBe(type)
    }
  })

  it('maps in / not in to the array operators', () => {
    const included = builder()
    included.UserQuery.where('id', 'in', [1, 2])
    expect(operator(included.query).type).toBe('in')
    expect(operator(included.query).value).toEqual([1, 2])

    const excluded = builder()
    excluded.UserQuery.where('id', 'not in', [1, 2])
    const notIn = operator(excluded.query)
    expect(notIn.type).toBe('not')
    expect(notIn.child?.type).toBe('in')
  })

  it('refuses an operator outside the allowlist instead of passing it to TypeORM', () => {
    const { query, UserQuery } = builder()
    expect(() => UserQuery.where('id', '~~' as never, 1)).toThrow(
      '[@laratype/database] where() takes one of =, !=, <, <=, >, >=, like, not like, in, not in, got "~~"',
    )
    expect(query.wheres).toEqual([])
  })

  it('refuses a non-array value for in / not in', () => {
    const { UserQuery } = builder()
    expect(() => UserQuery.where('id', 'in', 1 as never)).toThrow(
      '[@laratype/database] where() takes an array for "in", got 1',
    )
  })

  it('refuses a column that is not in the entity metadata, so no caller string reaches the SQL', () => {
    // `posts` stands for a relation, and `street` / `address.street` for an embedded column: DB3 #147 never sees
    // either, and an embedded leaf is not an own model property
    const hostile = [
      'id; DROP TABLE users',
      '"id" OR 1=1',
      '__proto__',
      'constructor',
      'posts',
      'street',
      'address.street',
    ]
    for (const column of hostile) {
      const { query, UserQuery } = builder()
      expect(() => UserQuery.where(column as never, 1)).toThrow(
        `[@laratype/database] User has no column ${JSON.stringify(column)}: where() takes a column property of the model`,
      )
      expect(query.wheres).toEqual([])
    }
  })

  it('refuses a first argument that is neither a column name nor an object', () => {
    const { query, UserQuery } = builder()
    for (const value of [null, 1, true, undefined]) {
      expect(() => UserQuery.where(value as never)).toThrow(
        '[@laratype/database] where() takes a column name or a where object, got',
      )
    }
    expect(query.wheres).toEqual([])
  })

  it('refuses a hostile own key in the object form', () => {
    for (const column of ['__proto__', 'constructor', 'id; DROP TABLE users']) {
      const { query, UserQuery } = builder()
      expect(() => UserQuery.where(JSON.parse(`{"${column}": 1}`))).toThrow('has no column')
      expect(query.wheres).toEqual([])
    }
  })
})

describe('ModelQueryBuilder.orderBy', () => {
  it('orders by the metadata property path, ascending by default', () => {
    const { query, UserQuery } = builder()
    expect(UserQuery.orderBy('email')).toBe(UserQuery)
    expect(query.orderBys).toEqual([['User.email', 'ASC']])
    UserQuery.orderBy('email', 'desc')
    expect(query.orderBys[1]).toEqual(['User.email', 'DESC'])
    // The runtime accepts any case, as the type lowercases the literal
    UserQuery.orderBy('email', 'DESC' as never)
    expect(query.orderBys[2]).toEqual(['User.email', 'DESC'])
  })

  it('refuses a direction outside asc / desc', () => {
    const { query, UserQuery } = builder()
    for (const direction of ['desc; DROP TABLE users', 'up', '']) {
      expect(() => UserQuery.orderBy('email', direction as never)).toThrow(
        `[@laratype/database] orderBy() takes "asc" or "desc", got ${JSON.stringify(direction)}`,
      )
    }
    expect(query.orderBys).toEqual([])
  })

  it('refuses a hostile column name', () => {
    const { query, UserQuery } = builder()
    expect(() => UserQuery.orderBy('id; DROP TABLE users' as never)).toThrow(
      '[@laratype/database] User has no column "id; DROP TABLE users": orderBy() takes a column property of the model',
    )
    expect(query.orderBys).toEqual([])
  })
})

describe('ModelQueryBuilder.limit', () => {
  it('sets a positive safe LIMIT', () => {
    const { query, UserQuery } = builder()
    UserQuery.limit(10)
    expect(query.limits).toEqual([10])
  })

  it('refuses a limit that is not a positive safe integer', () => {
    const { query, UserQuery } = builder()
    for (const count of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY]) {
      expect(() => UserQuery.limit(count)).toThrow('[@laratype/database] limit() takes a positive safe integer, got')
    }
    expect(query.limits).toEqual([])
  })
})

describe('ModelQueryBuilder.first and get', () => {
  it('resolves the first row or null, and every row', async () => {
    const rows = [{ id: 1, email: 'ada@example.com' }]
    const { UserQuery } = builder(rows)
    expect(await UserQuery.first()).toBe(rows[0])
    expect(await UserQuery.get()).toBe(rows)
    expect(await builder().UserQuery.first()).toBeNull()
  })
})

describe('ModelQueryBuilder.paginate', () => {
  it('returns a plain page with the requested window and the full total', async () => {
    const rows = [{ id: 1, email: 'ada@example.com' }]
    const { query, UserQuery } = builder(rows, 21)
    expect(await UserQuery.paginate(3, 10)).toEqual({
      data: rows,
      total: 21,
      perPage: 10,
      currentPage: 3,
      lastPage: 3,
    })
    expect(query.offsets).toEqual([20])
    expect(query.limits).toEqual([10])
  })

  it('defaults to page 1 and 15 per page, and gives an empty result lastPage 1', async () => {
    const { query, UserQuery } = builder([], 0)
    expect(await UserQuery.paginate()).toEqual({
      data: [],
      total: 0,
      perPage: 15,
      currentPage: 1,
      lastPage: 1,
    })
    expect(query.offsets).toEqual([0])
    expect(query.limits).toEqual([15])
  })

  it('accepts a huge safe page whose offset is still safe', async () => {
    const { query, UserQuery } = builder()
    await UserQuery.paginate(1_000_000_000, 15)
    expect(query.offsets).toEqual([14_999_999_985])
  })

  it('refuses a page that is not a positive safe integer', async () => {
    for (const page of [Number.NaN, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY]) {
      const { query, UserQuery } = builder()
      await expect(UserQuery.paginate(page)).rejects.toThrow(
        '[@laratype/database] paginate() takes a page of 1 or more (a safe integer), got',
      )
      expect(query.offsets).toEqual([])
    }
  })

  it('refuses a perPage outside 1 to 100', async () => {
    for (const perPage of [Number.NaN, -1, 0, 1.5, 101, 1_000_000_000, Number.MAX_SAFE_INTEGER + 1]) {
      const { query, UserQuery } = builder()
      await expect(UserQuery.paginate(1, perPage)).rejects.toThrow(
        '[@laratype/database] paginate() takes a perPage of 1 to 100, got',
      )
      expect(query.limits).toEqual([])
    }
  })

  it('refuses a page and perPage whose offset leaves the safe integer range', async () => {
    const { query, UserQuery } = builder()
    await expect(UserQuery.paginate(Number.MAX_SAFE_INTEGER, 100)).rejects.toThrow(
      '[@laratype/database] paginate() takes a page and perPage whose offset is a safe integer, got page 9007199254740991 and perPage 100',
    )
    expect(query.offsets).toEqual([])
  })
})
