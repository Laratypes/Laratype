// The typed query facade: typed columns, an operator allowlist mapped to FindOperators, a metadata column check, a
// runtime-checked direction / limit / page / perPage, and a plain page result (docs/v1/database.md › Model).
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { format } from 'mysql2'
import {
  DataSource,
  EntitySchema,
  type ObjectLiteral,
  type QueryRunner,
  type Repository,
  SelectQueryBuilder,
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
  /** The window this builder itself carries, as a clone copies it; `limits` / `offsets` are the calls it saw. */
  limitValue?: number
  offsetValue?: number
  /** Every builder `clone()` returned, so a test can tell the page query from the one the facade keeps. */
  readonly clones: FakeQueryBuilder[] = []

  constructor(
    private readonly rows: Row[],
    private readonly total = rows.length,
  ) {}

  clone() {
    const copy = new FakeQueryBuilder(this.rows, this.total)
    // A TypeORM clone keeps the conditions and orderBys set so far, not the calls made after it
    copy.conditions.push(...this.conditions)
    copy.orderBys.push(...this.orderBys)
    copy.limits.push(...this.limits)
    copy.offsets.push(...this.offsets)
    copy.limitValue = this.limitValue
    copy.offsetValue = this.offsetValue
    this.clones.push(copy)
    return copy
  }

  andWhere(where: string | ObjectLiteral, parameters?: ObjectLiteral) {
    this.conditions.push({ sql: where, parameters })
    return this
  }

  orderBy(sort: string, order: 'ASC' | 'DESC') {
    this.orderBys.push([sort, order])
    return this
  }

  limit(count?: number) {
    if (count !== undefined) this.limits.push(count)
    this.limitValue = count
    return this
  }

  offset(count?: number) {
    if (count !== undefined) this.offsets.push(count)
    this.offsetValue = count
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

  async getCount() {
    return this.total
  }
}

/** A transformer that lower-cases a string, as an app's email column does. */
const lower: ValueTransformer = {
  to: (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : value),
  from: (value: unknown) => value,
}

/** A transformer array: its `to()` functions run in declaration order, as `ID-` + lower-casing and lower-casing + `ID-` differ. */
const prefix: ValueTransformer = {
  to: (value: unknown) => (typeof value === 'string' ? `ID-${value}` : value),
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
    expect(query.conditions).toEqual([{ sql: 'User.email = :where_0', parameters: { where_0: 'ada@example.com' } }])
  })

  it('adds every column of the object form as its own equality condition', () => {
    const { query, UserQuery } = builder()
    UserQuery.where({ email: 'ada@example.com', isActive: true })
    expect(query.conditions).toEqual([
      { sql: 'User.email = :where_0', parameters: { where_0: 'ada@example.com' } },
      { sql: 'User.isActive = :where_1', parameters: { where_1: true } },
    ])
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
    // Neither does a very long one, nor one with a lone surrogate: the message is the same short text
    for (const value of ['x'.repeat(10_000), '\uD800', 'a\u0000b']) {
      const { UserQuery } = builder()
      try {
        UserQuery.where('id', value as never, 1)
        throw new Error('the call did not throw')
      } catch (error) {
        expect((error as Error).message).toBe(
          '[@laratype/database] where() takes one of =, !=, <, <=, >, >=, like, not like, in, not in, got string',
        )
      }
    }
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
      // A lone surrogate and a control character are not a column either, and the diagnostic never echoes one raw
      '\uD800',
      'a\u0000b',
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

  it('binds a very long, unicode or control-character string unchanged', () => {
    const values = ['x'.repeat(10_000), '\uD800', 'a\u0000b', '\u{1F600}\u0301', 'line\nbreak']
    for (const value of values) {
      const { query, UserQuery } = builder()
      UserQuery.where('email', '=', value)
      expect(parameters(query)).toEqual({ where_0: value })
    }
    // The same values pass through a transformer and an in list unchanged
    const inList = builder()
    inList.UserQuery.where('lowerEmail', 'in', values.map((value) => value.toUpperCase()))
    expect(parameters(inList.query)).toEqual({ where_0: values })
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

  it('reads each in / not in element once, so an array getter cannot swap the bound value', () => {
    for (const operator of ['in', 'not in'] as const) {
      const values = [1, 2, 3]
      let reads = 0
      // The old code read index 0 once to validate and again to bind: the second read returned undefined
      Object.defineProperty(values, 0, {
        enumerable: true,
        configurable: true,
        get: () => (reads++ === 0 ? 1 : undefined),
      })
      const { query, UserQuery } = builder()
      UserQuery.where('id', operator, values)
      expect(reads, operator).toBe(1)
      expect(parameters(query), operator).toEqual({ where_0: [1, 2, 3] })
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

  it('refuses an array as the where object, which would otherwise add no filter', () => {
    for (const value of [[], [1, 2], ['email']]) {
      const { query, UserQuery } = builder()
      expect(() => UserQuery.where(value as never)).toThrow(
        '[@laratype/database] where() takes a column name or a where object, got array',
      )
      expect(query.conditions).toEqual([])
    }
  })

  it('names a value it cannot stringify by its type instead of throwing a TypeError', () => {
    // Object.create(null) has no toString, the second object's toString throws, and the Proxy's get trap throws:
    // formatting the refused value's diagnostic must still give the documented ModelError, not a TypeError
    const noPrototype = Object.create(null) as object
    const throwingToString = {
      toString: () => {
        throw new Error('toString() must not escape')
      },
    }
    const throwingProxy = new Proxy({}, {
      get: () => {
        throw new Error('get() must not escape')
      },
    })
    for (const value of [noPrototype, throwingToString, throwingProxy]) {
      const { query, UserQuery } = builder()
      expect(() => UserQuery.limit(value as never)).toThrow(
        '[@laratype/database] limit() takes a positive safe integer, got object',
      )
      expect(query.limits).toEqual([])
    }
    // A symbol reaches the first-argument diagnostic, where String(symbol) is defined
    const { UserQuery } = builder()
    expect(() => UserQuery.where(Symbol('ada') as never)).toThrow(
      '[@laratype/database] where() takes a column name or a where object, got Symbol(ada)',
    )
  })

  it('ignores inherited and non-enumerable keys in the object form', () => {
    const where = Object.create({ email: 'ada@example.com' }) as Record<string, unknown>
    Object.defineProperty(where, 'isActive', { value: true, enumerable: false })
    where.id = 1
    const { query, UserQuery } = builder()
    UserQuery.where(where as never)
    // Only own enumerable keys reach the condition; an inherited or hidden key is not a column filter
    expect(query.conditions).toEqual([{ sql: 'User.id = :where_0', parameters: { where_0: 1 } }])
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
    expect(parameters(prefixed.query)).toEqual({ where_0: 'ID-ADA' })
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
    // lower() then prefix() gives "ID-ada"; the reverse order would give "id-ada", so this assertion detects it
    expect(parameters(query)).toEqual({ where_0: 'ID-ada' })
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

  it('applies the transformer to the two-argument and object forms once, for a scalar value', () => {
    const { query, UserQuery } = builder()
    UserQuery.where('email', '=', 'ADA@EXAMPLE.COM').where({ lowerEmail: 'ADA@EXAMPLE.COM' })
    expect(parameters(query, 0)).toEqual({ where_0: 'ADA@EXAMPLE.COM' })
    expect(query.conditions[1]).toEqual({
      sql: 'User.lowerEmail = :where_1',
      parameters: { where_1: 'ada@example.com' },
    })
  })

  it('refuses an object-returning transformer in the two-argument and object forms, so mysql2 never gets one', () => {
    const message = '[@laratype/database] where() transformer for "hostile" returned object:'
      + ' a transformer must return a scalar value (a string, a finite number, a bigint, a boolean, a valid Date or a Buffer)'
    const twoArgument = builder()
    expect(() => twoArgument.UserQuery.where('hostile', 'ada')).toThrow(message)
    expect(twoArgument.query.conditions).toEqual([])

    // The object form builds every condition itself, so TypeORM cannot apply the transformer again outside the check
    const objectForm = builder()
    expect(() => objectForm.UserQuery.where({ hostile: 'ada' } as never)).toThrow(message)
    expect(objectForm.query.conditions).toEqual([])

    // A valid key before the refused one is not half-added: the call validates every key before it writes
    const mixed = builder()
    expect(() => mixed.UserQuery.where({ email: 'ada@example.com', hostile: 'ada' } as never)).toThrow(message)
    expect(mixed.query.conditions).toEqual([])
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
    // The page runs on a clone: the base builder keeps no window for a later get()
    expect(query.clones[0]?.offsets).toEqual([20])
    expect(query.clones[0]?.limits).toEqual([10])
    expect(query.offsets).toEqual([])
    expect(query.limitValue).toBeUndefined()
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
    expect(query.clones[0]?.offsets).toEqual([0])
    expect(query.clones[0]?.limits).toEqual([15])
  })

  it('accepts a huge safe page whose offset is still safe', async () => {
    const { query, UserQuery } = builder()
    await UserQuery.paginate(1_000_000_000, 15)
    expect(query.clones[0]?.offsets).toEqual([14_999_999_985])
  })

  it('refuses a page that is not a positive safe integer', async () => {
    for (const page of [Number.NaN, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY]) {
      const { query, UserQuery } = builder()
      await expect(UserQuery.paginate(page)).rejects.toThrow(
        '[@laratype/database] paginate() takes a page of 1 or more (a safe integer), got',
      )
      expect(query.clones).toEqual([])
      expect(query.offsets).toEqual([])
    }
  })

  it('refuses a perPage outside 1 to 100', async () => {
    for (const perPage of [Number.NaN, -1, 0, 1.5, 101, 1_000_000_000, Number.MAX_SAFE_INTEGER + 1]) {
      const { query, UserQuery } = builder()
      await expect(UserQuery.paginate(1, perPage)).rejects.toThrow(
        '[@laratype/database] paginate() takes a perPage of 1 to 100, got',
      )
      expect(query.clones).toEqual([])
      expect(query.limits).toEqual([])
    }
  })

  it('refuses a page and perPage whose offset leaves the safe integer range', async () => {
    const { query, UserQuery } = builder()
    await expect(UserQuery.paginate(Number.MAX_SAFE_INTEGER, 100)).rejects.toThrow(
      '[@laratype/database] paginate() takes a page and perPage whose offset is a safe integer, got page 9007199254740991 and perPage 100',
    )
    expect(query.clones).toEqual([])
    expect(query.offsets).toEqual([])
  })

  it('keeps an earlier limit on the base builder and gives the page its own window', async () => {
    const rows = [{ id: 1, email: 'ada@example.com' }]
    const { query, UserQuery } = builder(rows, 21)
    UserQuery.limit(5)
    await UserQuery.paginate(2, 10)
    expect(query.limitValue).toBe(5)
    expect(query.offsetValue).toBeUndefined()
    expect(query.clones[0]?.limitValue).toBe(10)
    expect(query.clones[0]?.offsetValue).toBe(10)
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
        isActive: { type: Boolean },
        lowerEmail: { type: String, transformer: lower },
        hostile: { type: String, transformer: toObject },
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

  /** A repository whose `createQueryBuilder()` is the given builder, for the pagination probes. */
  const repositoryUsing = (repository: Repository<Row>, query: SelectQueryBuilder<Row>): Repository<Row> =>
    ({ metadata: repository.metadata, createQueryBuilder: () => query } as unknown as Repository<Row>)

  /**
   * A real `SelectQueryBuilder` whose two terminal reads are answered from memory, so `getManyAndCount()`'s real
   * `lazyCount()` branch runs without a database. `clone()` keeps the class, and the closure gives every clone the
   * same read function.
   */
  const inMemoryBuilder = (
    source: SelectQueryBuilder<Row>,
    read: (builder: SelectQueryBuilder<Row>) => Promise<{ rows: Row[]; total: number }>,
  ) => {
    const queryRunner = { isTransactionActive: false } as unknown as QueryRunner
    class InMemoryQueryBuilder extends SelectQueryBuilder<Row> {
      constructor(queryBuilder: SelectQueryBuilder<Row>) {
        super(queryBuilder)
        this.queryRunner = queryRunner
      }

      protected override async executeEntitiesAndRawResults(): Promise<{ entities: Row[]; raw: Row[] }> {
        const { rows } = await read(this)
        return { entities: rows, raw: rows }
      }

      protected override async executeCountQuery(): Promise<number> {
        return (await read(this)).total
      }
    }
    return new InMemoryQueryBuilder(source)
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

  it('applies a transformer to the two-argument form once, before TypeORM sees it', async () => {
    const repository = await realRepository()
    const query = new ModelQueryBuilder<Row>(repository)
    query.where('lowerEmail', 'ADA@EXAMPLE.COM')
    const builder = (query as unknown as { query: SelectQueryBuilder<Row> }).query
    const [sql, parameters] = builder.getQueryAndParameters()
    expect(sql).toContain('WHERE `User`.`lowerEmail` = ?')
    expect(parameters).toEqual(['ada@example.com'])
  })

  it('applies each object-form transformer once and keeps both filters', async () => {
    const repository = await realRepository()
    const query = new ModelQueryBuilder<Row>(repository)
    query.where({ lowerEmail: 'ADA@EXAMPLE.COM', email: 'ADA@EXAMPLE.COM' })
    const builder = (query as unknown as { query: SelectQueryBuilder<Row> }).query
    const [sql, parameters] = builder.getQueryAndParameters()
    expect(sql).toContain('WHERE `User`.`lowerEmail` = ?')
    expect(sql).toContain('AND `User`.`email` = ?')
    expect(parameters).toEqual(['ada@example.com', 'ADA@EXAMPLE.COM'])
  })

  it('refuses an array as the where object before TypeORM can build an unfiltered query', async () => {
    // The probe: an empty object form adds no WHERE, and mysql2.format() would send the unfiltered statement
    expect(format('SELECT * FROM `user`')).not.toContain('WHERE')
    const repository = await realRepository()
    const query = new ModelQueryBuilder<Row>(repository)
    expect(() => query.where([] as never)).toThrow(
      '[@laratype/database] where() takes a column name or a where object, got array',
    )
    const builder = (query as unknown as { query: SelectQueryBuilder<Row> }).query
    const [sql, parameters] = builder.getQueryAndParameters()
    expect(sql).not.toContain('WHERE')
    expect(format(sql, parameters)).not.toContain('WHERE')
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

  it('never lets an object-returning transformer reach the builder, in either form', async () => {
    const repository = await realRepository()
    const query = new ModelQueryBuilder<Row>(repository)
    expect(() => query.where('hostile', 'ada')).toThrow(ModelError)
    expect(() => query.where({ hostile: 'ada' } as never)).toThrow(ModelError)
    const builder = (query as unknown as { query: SelectQueryBuilder<Row> }).query
    const [sql, parameters] = builder.getQueryAndParameters()
    expect(sql).not.toContain('WHERE')
    expect(parameters).toEqual([])
  })

  it('counts an empty non-first page again, where TypeORM lazyCount would return the offset', async () => {
    const repository = await realRepository()
    const state = { total: 21, counts: [] as [number | undefined, number | undefined][] }
    const builder = inMemoryBuilder(repository.createQueryBuilder(), async (query) => {
      if (query.expressionMap.limit !== undefined) {
        // The page itself: 10 rows past the end of 21
        return { rows: [], total: state.total }
      }
      // The separate count: the page window is gone
      state.counts.push([query.expressionMap.offset, query.expressionMap.limit])
      return { rows: [], total: state.total }
    })
    const query = new ModelQueryBuilder<Row>(repositoryUsing(repository, builder))
    // Read lazily: TypeORM returns offset + rows (20) for this page, not the full 21
    await expect(query.paginate(4, 10)).resolves.toEqual({
      data: [],
      total: 21,
      perPage: 10,
      currentPage: 4,
      lastPage: 3,
    })
    expect(state.counts).toEqual([[undefined, undefined]])
  })

  it('gives two concurrent paginate() calls their own filters, window and total', async () => {
    const repository = await realRepository()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const builder = inMemoryBuilder(repository.createQueryBuilder(), async (query) => {
      await gate
      // A full page makes TypeORM run its count; the count follows the builder's own, snapshotted filters
      return {
        rows: Array.from({ length: 10 }, (_, id) => ({ id })),
        total: 10 * query.expressionMap.wheres.length,
      }
    })
    const query = new ModelQueryBuilder<Row>(repositoryUsing(repository, builder))
    const first = query.where('isActive', true).paginate(1, 10)
    const second = query.where('email', 'ada@example.com').paginate(2, 10)
    release()
    const [one, two] = await Promise.all([first, second])
    // The clones were taken before either filter could leak: one filter counts 10, two count 20
    expect([one.total, two.total]).toEqual([10, 20])
    expect([one.currentPage, two.currentPage]).toEqual([1, 2])
    expect(builder.expressionMap.offset).toBeUndefined()
    expect(builder.expressionMap.limit).toBeUndefined()
  })
})
