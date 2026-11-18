// The typed query facade: typed columns, an operator allowlist mapped to FindOperators, a metadata column check, a
// runtime-checked direction / limit / page / perPage, and a plain page result (docs/v1/database.md › Model).
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { format } from 'mysql2'
import {
  DataSource,
  EntitySchema,
  type ObjectLiteral,
  type Repository,
  type SelectQueryBuilder,
  type ValueTransformer,
} from 'typeorm'
import ModelError from '../src/exceptions/ModelError'
import ModelQueryBuilder from '../src/eloquent/ModelQueryBuilder'

type Row = Record<string, any>

/** One `andWhere()` call the facade made: its condition (a SQL string or an object form) and its parameters. */
interface Condition {
  readonly sql: string | ObjectLiteral
  readonly parameters?: ObjectLiteral
}

/** The slice of a TypeORM SelectQueryBuilder the facade reaches, over arrays in memory, so the test needs no database. */
class FakeQueryBuilder {
  readonly alias = 'User'
  readonly conditions: Condition[] = []
  readonly orderBys: [string, string][] = []
  readonly limits: number[] = []
  readonly offsets: number[] = []

  constructor(
    private readonly rows: Row[],
    private readonly total = rows.length,
  ) {}

  andWhere(where: string | ObjectLiteral, parameters?: ObjectLiteral) {
    this.conditions.push({ sql: where, parameters })
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

/** A transformer that lower-cases a string, as an app's email column does. */
const lower: ValueTransformer = {
  to: (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : value),
  from: (value: unknown) => value,
}

/** A transformer array: its `to()` functions run in declaration order. */
const prefix: ValueTransformer = {
  to: (value: unknown) => (typeof value === 'string' ? `id-${value}` : value),
  from: (value: unknown) => value,
}

/** A transformer that returns an object, which mysql2 would escape as SQL text. */
const toObject: ValueTransformer = { to: () => ({ email: 1 }), from: (value: unknown) => value }

/** A model query over `rows`, with the entity metadata the facade resolves columns against. */
const builder = (rows: Row[] = [], total = rows.length) => {
  const columns = [
    { propertyName: 'id', propertyPath: 'id', type: Number },
    { propertyName: 'email', propertyPath: 'email', type: String },
    { propertyName: 'age', propertyPath: 'age', type: Number },
    { propertyName: 'isActive', propertyPath: 'isActive', type: Boolean },
    { propertyName: 'deletedAt', propertyPath: 'deletedAt', type: Date },
    // A column with a value transformer, and one whose transformer array runs in declaration order
    { propertyName: 'lowerEmail', propertyPath: 'lowerEmail', type: String, transformer: lower },
    { propertyName: 'serial', propertyPath: 'serial', type: String, transformer: [lower, prefix] },
    { propertyName: 'prefixed', propertyPath: 'prefixed', type: String, transformer: prefix },
    { propertyName: 'hostile', propertyPath: 'hostile', type: String, transformer: toObject },
    // An embedded column: its leaf `street` is not an own model property
    { propertyName: 'street', propertyPath: 'address.street', type: String },
    // A relation's join column: TypeORM sets relationMetadata and names it after the relation property
    { propertyName: 'author', propertyPath: 'author', type: Number, relationMetadata: {} },
    // A user-declared foreign key column of a relation carries relationMetadata too
    { propertyName: 'authorId', propertyPath: 'authorId', type: Number, relationMetadata: {} },
  ]
  const query = new FakeQueryBuilder(rows, total)
  const repository = {
    metadata: { targetName: 'User', columns },
    createQueryBuilder: () => query,
  } as unknown as Repository<Row>
  return { query, UserQuery: new ModelQueryBuilder<Row>(repository) }
}

/** The SQL string of the `index`th condition. */
const condition = (query: FakeQueryBuilder, index = 0): string => {
  const entry = query.conditions[index]
  if (entry === undefined) throw new Error("the where() call did not reach the query builder")
  if (typeof entry.sql !== 'string') throw new Error('the where() call used the object form')
  return entry.sql
}

/** The parameters of the `index`th condition. */
const parameters = (query: FakeQueryBuilder, index = 0): ObjectLiteral | undefined =>
  query.conditions[index]?.parameters

/** The scalar kinds the facade's diagnostics list. */
const SCALAR_KINDS = 'a string, a finite number, a bigint, a boolean, a valid Date or a Buffer'

/** One accepted value of every scalar kind. */
const SCALAR_VALUES = ['ada@example.com', 36, 1n, true, new Date('2026-01-02'), Buffer.from('ada')]

/** A value mysql2 would escape as SQL text, and the type name the diagnostic gives it. */
const NON_SCALARS: [unknown, string][] = [
  [{ email: 1 }, 'object'],
  [{ $ne: '' }, 'object'],
  [[1, 2], 'array'],
  [{}, 'object'],
  [[], 'array'],
  [Number.NaN, 'non-finite number'],
  [Number.POSITIVE_INFINITY, 'non-finite number'],
  [new Date('nope'), 'invalid Date'],
  // An object with Date.prototype has no Date slot: valueType() reads the slot, not the prototype
  [Object.create(Date.prototype), 'object'],
  [new Proxy(new Date('2026-01-02'), {}), 'object'],
  // mysql2 binds only a Buffer as one value: it expands these into SQL text, so the facade refuses every one
  [new Uint8Array([1, 2]), 'object'],
  [new Uint16Array([1, 2]), 'object'],
  [new ArrayBuffer(2), 'object'],
  [new DataView(new ArrayBuffer(2)), 'object'],
]

const scalarMessage = (column: string, type: string) =>
  `[@laratype/database] where() takes a scalar value for ${JSON.stringify(column)} (${SCALAR_KINDS}), got ${type}`

const inElementMessage = (column: string, operatorName: string, type: string) =>
  `[@laratype/database] where() takes scalar elements for ${JSON.stringify(column)}`
  + ` in ${JSON.stringify(operatorName)} (${SCALAR_KINDS}), got ${type} at index 0`

const nullishMessage = (column: string, value: unknown) =>
  `[@laratype/database] where() cannot filter ${JSON.stringify(column)} with ${String(value)}:`
  + ' IS NULL filters are not part of the v1 surface'

describe('ModelQueryBuilder.where', () => {
  it('adds an equality condition for the two-argument form', () => {
    const { query, UserQuery } = builder()
    expect(UserQuery.where('email', 'ada@example.com')).toBe(UserQuery)
    expect(query.conditions).toEqual([{ sql: { email: 'ada@example.com' }, parameters: undefined }])
  })

  it('adds every column of the object form in one condition', () => {
    const { query, UserQuery } = builder()
    UserQuery.where({ email: 'ada@example.com', isActive: true })
    expect(query.conditions).toEqual([{ sql: { email: 'ada@example.com', isActive: true }, parameters: undefined }])
  })

  it('maps every comparison to its SQL comparison, with the value bound as a parameter', () => {
    const cases = [
      ['=', '='],
      ['!=', '!='],
      ['<', '<'],
      ['<=', '<='],
      ['>', '>'],
      ['>=', '>='],
      ['like', 'LIKE'],
      ['not like', 'NOT LIKE'],
    ] as const
    for (const [comparison, sql] of cases) {
      const { query, UserQuery } = builder()
      UserQuery.where('age', comparison, 21)
      expect(condition(query), comparison).toBe(`User.age ${sql} :where_0`)
      expect(parameters(query), comparison).toEqual({ where_0: 21 })
    }
  })

  it('maps in / not in to a bound list parameter', () => {
    const included = builder()
    included.UserQuery.where('id', 'in', [1, 2])
    expect(condition(included.query)).toBe('User.id IN (:...where_0)')
    expect(parameters(included.query)).toEqual({ where_0: [1, 2] })

    const excluded = builder()
    excluded.UserQuery.where('id', 'not in', [1, 2])
    expect(condition(excluded.query)).toBe('User.id NOT IN (:...where_0)')
    expect(parameters(excluded.query)).toEqual({ where_0: [1, 2] })
  })

  it('gives every condition its own parameter, so ANDed where() calls keep their values', () => {
    const { query, UserQuery } = builder()
    UserQuery.where('id', '>', 1).where('age', '<', 9)
    expect(query.conditions.map((entry) => entry.sql)).toEqual(['User.id > :where_0', 'User.age < :where_1'])
    expect(query.conditions.map((entry) => entry.parameters)).toEqual([{ where_0: 1 }, { where_1: 9 }])
  })

  it('keeps an empty in / not in list matching none / all', () => {
    const included = builder()
    included.UserQuery.where('id', 'in', [])
    expect(condition(included.query)).toBe('0=1')

    const excluded = builder()
    excluded.UserQuery.where('id', 'not in', [])
    expect(condition(excluded.query)).toBe('1=1')
  })

  it('refuses an operator outside the allowlist instead of passing it to TypeORM', () => {
    const { query, UserQuery } = builder()
    expect(() => UserQuery.where('id', '~~' as never, 1)).toThrow(
      '[@laratype/database] where() takes one of =, !=, <, <=, >, >=, like, not like, in, not in, got string',
    )
    expect(query.conditions).toEqual([])
  })

  it('names the type of a refused operator, never the value', () => {
    const cases: [unknown, string][] = [
      [1, 'number'],
      [Number.NaN, 'non-finite number'],
      [null, 'null'],
      [undefined, 'undefined'],
      ['__proto__', 'string'],
      [{ length: 1e9 }, 'object'],
      [['in'], 'array'],
      [new Date('nope'), 'invalid Date'],
    ]
    for (const [value, type] of cases) {
      const { query, UserQuery } = builder()
      const message = `[@laratype/database] where() takes one of =, !=, <, <=, >, >=, like, not like, in, not in, got ${type}`
      expect(() => UserQuery.where('id', value as never, 1)).toThrow(message)
      expect(query.conditions).toEqual([])
    }
    // A hostile string never reaches the message: only its type is named
    const hostile = 'id, id; DROP TABLE users'
    expect(() => builder().UserQuery.where('id', hostile as never, 1))
      .toThrow('[@laratype/database] where() takes one of =, !=, <, <=, >, >=, like, not like, in, not in, got string')
  })

  it('names the type of a refused in / not in operand, never the value', () => {
    const cases: [unknown, string][] = [
      [1, 'number'],
      [Number.POSITIVE_INFINITY, 'non-finite number'],
      [{ length: 1e9 }, 'object'],
      [new Date('nope'), 'invalid Date'],
      [new Date('2026-01-02'), 'Date'],
      ['id; DROP TABLE users', 'string'],
    ]
    for (const [value, type] of cases) {
      const { query, UserQuery } = builder()
      expect(() => UserQuery.where('id', 'in', value as never)).toThrow(
        `[@laratype/database] where() takes an array for "in", got ${type}`,
      )
      expect(query.conditions).toEqual([])
    }
  })

  it('refuses a non-array value for in / not in', () => {
    const { UserQuery } = builder()
    expect(() => UserQuery.where('id', 'in', 1 as never)).toThrow(
      '[@laratype/database] where() takes an array for "in", got number',
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
      expect(query.conditions).toEqual([])
    }
  })

  it('refuses a relation join column, which is not an own model column', () => {
    const { query, UserQuery } = builder()
    for (const column of ['author', 'authorId']) {
      expect(() => UserQuery.where(column as never, 5)).toThrow(
        `[@laratype/database] User has no column ${JSON.stringify(column)}: where() takes a column property of the model`,
      )
      expect(() => UserQuery.where({ [column]: 5 } as never)).toThrow(
        `[@laratype/database] User has no column ${JSON.stringify(column)}: where() takes a column property of the model`,
      )
      expect(() => UserQuery.orderBy(column as never)).toThrow(
        `[@laratype/database] User has no column ${JSON.stringify(column)}: orderBy() takes a column property of the model`,
      )
    }
    expect(query.conditions).toEqual([])
    expect(query.orderBys).toEqual([])
  })

  it('refuses a null or undefined value in the two-argument form', () => {
    const { query, UserQuery } = builder()
    for (const value of [null, undefined]) {
      expect(() => UserQuery.where('email', value as never)).toThrow(
        `[@laratype/database] where() cannot filter "email" with ${String(value)}: IS NULL filters are not part of the v1 surface`,
      )
    }
    expect(query.conditions).toEqual([])
  })

  it('refuses a null or undefined value in the object form', () => {
    const { query, UserQuery } = builder()
    for (const value of [null, undefined]) {
      expect(() => UserQuery.where({ email: value } as never)).toThrow(
        `[@laratype/database] where() cannot filter "email" with ${String(value)}: IS NULL filters are not part of the v1 surface`,
      )
    }
    expect(query.conditions).toEqual([])
  })

  it('refuses a null or undefined value for every comparison operator', () => {
    const { query, UserQuery } = builder()
    const operators = ['=', '!=', '<', '<=', '>', '>=', 'like', 'not like', 'in', 'not in'] as const
    for (const operator of operators) {
      for (const value of [null, undefined]) {
        expect(() => UserQuery.where('email', operator, value as never)).toThrow(
          `[@laratype/database] where() cannot filter "email" with ${String(value)}: IS NULL filters are not part of the v1 surface`,
        )
      }
    }
    expect(query.conditions).toEqual([])
  })

  it('refuses a value that mysql2 would escape as key = value pairs in the two-argument form', () => {
    for (const [value, type] of NON_SCALARS) {
      const { query, UserQuery } = builder()
      expect(() => UserQuery.where('email', value as never)).toThrow(scalarMessage('email', type))
      expect(query.conditions).toEqual([])
    }
  })

  it('refuses a non-scalar value in the object form', () => {
    for (const [value, type] of NON_SCALARS) {
      const { query, UserQuery } = builder()
      expect(() => UserQuery.where({ email: value } as never)).toThrow(scalarMessage('email', type))
      expect(query.conditions).toEqual([])
    }
  })

  it('refuses a non-scalar value for a comparison operator', () => {
    for (const operator of ['=', 'like'] as const) {
      for (const [value, type] of NON_SCALARS) {
        const { query, UserQuery } = builder()
        expect(() => UserQuery.where('email', operator, value as never)).toThrow(scalarMessage('email', type))
        expect(query.conditions).toEqual([])
      }
    }
  })

  it('accepts the scalar values TypeORM parameterizes', () => {
    for (const value of SCALAR_VALUES) {
      const { query, UserQuery } = builder()
      expect(() => UserQuery.where('email', value as never)).not.toThrow()
      expect(query.conditions).toHaveLength(1)
    }
  })

  it('accepts a Date subclass whose getTime throws, reading the Date slot instead', () => {
    const sneaky = new Date('2026-01-02')
    Object.defineProperty(sneaky, 'getTime', {
      value: () => {
        throw new Error('getTime() must not be called')
      },
    })
    const { query, UserQuery } = builder()
    expect(() => UserQuery.where('deletedAt', sneaky as never)).not.toThrow()
    expect(query.conditions).toHaveLength(1)
  })

  it('accepts a Buffer, but no other typed array, as an in / not in element', () => {
    for (const operator of ['in', 'not in'] as const) {
      const { query, UserQuery } = builder()
      expect(() => UserQuery.where('email', operator, [Buffer.from('ada')] as never)).not.toThrow()
      expect(query.conditions).toHaveLength(1)
    }
  })

  it('keeps every accepted scalar kind one parameter in mysql2, never SQL text', () => {
    // mysql2 is the driver behind TypeORM's mysql path: a future accepted kind it expands into identifiers (backticks)
    // would turn a filter value into SQL, the round 2 finding, and fails here instead
    for (const value of SCALAR_VALUES) {
      expect(format('SELECT ?', [value])).not.toContain('`')
    }
  })

  it('refuses in / not in elements that are not scalars', () => {
    for (const operator of ['in', 'not in'] as const) {
      for (const [element, type] of NON_SCALARS) {
        const { query, UserQuery } = builder()
        expect(() => UserQuery.where('email', operator, [element] as never)).toThrow(
          inElementMessage('email', operator, type),
        )
        expect(query.conditions).toEqual([])
      }
    }
  })

  it('refuses null and undefined inside an in / not in list', () => {
    for (const operator of ['in', 'not in'] as const) {
      for (const element of [null, undefined]) {
        const { UserQuery } = builder()
        expect(() => UserQuery.where('email', operator, [element] as never)).toThrow(
          nullishMessage('email', element),
        )
      }
    }
  })

  it('refuses an in / not in list over 1,000 elements', () => {
    const list = Array.from({ length: 1001 }, (_, index) => index)
    for (const operator of ['in', 'not in'] as const) {
      const { query, UserQuery } = builder()
      expect(() => UserQuery.where('email', operator, list as never)).toThrow(
        `[@laratype/database] where() takes at most 1000 elements for "email" in ${JSON.stringify(operator)}, got 1001`,
      )
      expect(query.conditions).toEqual([])
    }
  })

  it('accepts an in / not in list of 1,000 elements', () => {
    const list = Array.from({ length: 1000 }, (_, index) => index)
    const { UserQuery } = builder()
    expect(() => UserQuery.where('email', 'in', list as never)).not.toThrow()
  })

  it('truncates a long value in a diagnostic', () => {
    const long = 'x'.repeat(200)
    const { UserQuery } = builder()
    try {
      UserQuery.where(long as never, 1)
      throw new Error('the call did not throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ModelError)
      const message = (error as Error).message
      expect(message).toContain('…')
      expect(message).not.toContain(long)
      expect(message.length).toBeLessThan(250)
    }
  })

  it('refuses a first argument that is neither a column name nor an object', () => {
    const { query, UserQuery } = builder()
    for (const value of [null, 1, true, undefined]) {
      expect(() => UserQuery.where(value as never)).toThrow(
        '[@laratype/database] where() takes a column name or a where object, got',
      )
    }
    expect(query.conditions).toEqual([])
  })

  it('refuses a hostile own key in the object form', () => {
    for (const column of ['__proto__', 'constructor', 'id; DROP TABLE users']) {
      const { query, UserQuery } = builder()
      expect(() => UserQuery.where(JSON.parse(`{"${column}": 1}`))).toThrow('has no column')
      expect(query.conditions).toEqual([])
    }
  })
})

describe('ModelQueryBuilder.where transformers', () => {
  it('applies the column transformer to =, != and like values, exactly once', () => {
    const cases = [
      ['=', '='],
      ['!=', '!='],
      ['like', 'LIKE'],
    ] as const
    for (const [operator, sql] of cases) {
      const { query, UserQuery } = builder()
      UserQuery.where('lowerEmail', operator, 'ADA@EXAMPLE.COM')
      expect(condition(query), operator).toBe(`User.lowerEmail ${sql} :where_0`)
      expect(parameters(query), operator).toEqual({ where_0: 'ada@example.com' })
    }
    // A non-idempotent transformer proves the value goes through it once, not twice
    const prefixed = builder()
    prefixed.UserQuery.where('prefixed', '=', 'ADA')
    expect(parameters(prefixed.query)).toEqual({ where_0: 'id-ADA' })
  })

  it('applies the transformer to every in / not in element', () => {
    for (const operator of ['in', 'not in'] as const) {
      const { query, UserQuery } = builder()
      UserQuery.where('lowerEmail', operator, ['ADA@EXAMPLE.COM', 'BOB@EXAMPLE.COM'])
      expect(parameters(query), operator).toEqual({ where_0: ['ada@example.com', 'bob@example.com'] })
    }
  })

  it('runs a transformer array in declaration order', () => {
    const { query, UserQuery } = builder()
    UserQuery.where('serial', '=', 'ADA')
    expect(parameters(query)).toEqual({ where_0: 'id-ada' })
  })

  it('refuses a transformer that returns an object, so mysql2 never gets one', () => {
    const { query, UserQuery } = builder()
    expect(() => UserQuery.where('hostile', '=', 'ada')).toThrow(
      '[@laratype/database] where() transformer for "hostile" returned object:'
      + ' a transformer must return a scalar value (a string, a finite number, a bigint, a boolean, a valid Date or a Buffer)',
    )
    expect(query.conditions).toEqual([])
  })

  it('refuses an in element a transformer turns into an object, naming its index', () => {
    const { query, UserQuery } = builder()
    expect(() => UserQuery.where('hostile', 'in', ['ada', 'bob'])).toThrow(
      '[@laratype/database] where() transformer for "hostile" returned object at index 0 in "in":'
      + ' a transformer must return a scalar value (a string, a finite number, a bigint, a boolean, a valid Date or a Buffer)',
    )
    expect(query.conditions).toEqual([])
  })

  it('leaves a column without a transformer, and the object form, to TypeORM', () => {
    const { query, UserQuery } = builder()
    UserQuery.where('email', '=', 'ADA@EXAMPLE.COM').where({ lowerEmail: 'ADA@EXAMPLE.COM' })
    expect(parameters(query, 0)).toEqual({ where_0: 'ADA@EXAMPLE.COM' })
    expect(query.conditions[1]?.sql).toEqual({ lowerEmail: 'ADA@EXAMPLE.COM' })
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

describe('ModelQueryBuilder over the real TypeORM builder', () => {
  /** A mysql DataSource needs no connection to build its metadata and the SQL: mysql2 is a devDependency. */
  const realRepository = async () => {
    const User = new EntitySchema({
      name: 'User',
      tableName: 'user',
      columns: {
        id: { type: Number, primary: true, generated: true },
        email: { type: String },
        lowerEmail: { type: String, transformer: lower },
      },
    })
    const dataSource = new DataSource({
      type: 'mysql',
      host: 'localhost',
      username: 'laratype',
      password: 'laratype',
      database: 'laratype',
      entities: [User],
      synchronize: false,
    })
    // buildMetadatas is protected; the query builder needs the metadata, not a connection
    await (dataSource as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas()
    return dataSource.getRepository<Row>('User')
  }

  it('sends an accepted value as a parameter', async () => {
    const repository = await realRepository()
    const query = new ModelQueryBuilder<Row>(repository)
    query.where('email', 'ada@example.com')
    const builder = (query as unknown as { query: SelectQueryBuilder<Row> }).query
    const [sql, parameters] = builder.getQueryAndParameters()
    expect(sql).toContain('WHERE `User`.`email` = ?')
    expect(parameters).toEqual(['ada@example.com'])
  })

  it('applies a column transformer to a comparison value once, before TypeORM sees it', async () => {
    const repository = await realRepository()
    const query = new ModelQueryBuilder<Row>(repository)
    query.where('lowerEmail', '=', 'ADA@EXAMPLE.COM').where('lowerEmail', '!=', 'BOB@EXAMPLE.COM')
    const builder = (query as unknown as { query: SelectQueryBuilder<Row> }).query
    const [sql, parameters] = builder.getQueryAndParameters()
    // TypeORM 0.3.26 transforms the FindOperator wrapper an object-form andWhere() receives, so the facade builds
    // the comparison itself: the value reaches the driver transformed and once, never as a wrapper
    expect(sql).toContain('WHERE `User`.`lowerEmail` = ? AND `User`.`lowerEmail` != ?')
    expect(parameters).toEqual(['ada@example.com', 'bob@example.com'])
  })

  it('applies a column transformer to every in value', async () => {
    const repository = await realRepository()
    const query = new ModelQueryBuilder<Row>(repository)
    query.where('lowerEmail', 'in', ['ADA@EXAMPLE.COM', 'BOB@EXAMPLE.COM'])
    const builder = (query as unknown as { query: SelectQueryBuilder<Row> }).query
    const [sql, parameters] = builder.getQueryAndParameters()
    expect(sql).toContain('WHERE `User`.`lowerEmail` IN (?, ?)')
    expect(parameters).toEqual(['ada@example.com', 'bob@example.com'])
  })

  it('keeps the two-argument form to TypeORM, which applies the transformer once', async () => {
    const repository = await realRepository()
    const query = new ModelQueryBuilder<Row>(repository)
    query.where('lowerEmail', 'ADA@EXAMPLE.COM')
    const builder = (query as unknown as { query: SelectQueryBuilder<Row> }).query
    const [sql, parameters] = builder.getQueryAndParameters()
    expect(sql).toContain('WHERE `User`.`lowerEmail` = ?')
    expect(parameters).toEqual(['ada@example.com'])
  })

  it('never lets a refused value reach the builder', async () => {
    const repository = await realRepository()
    const query = new ModelQueryBuilder<Row>(repository)
    expect(() => query.where('email', { email: 1 } as never)).toThrow(ModelError)
    const builder = (query as unknown as { query: SelectQueryBuilder<Row> }).query
    const [sql, parameters] = builder.getQueryAndParameters()
    expect(sql).not.toContain('WHERE')
    expect(parameters).toEqual([])
  })
})
