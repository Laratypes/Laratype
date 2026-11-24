// The v1 Model statics over TypeORM: primaryKey, find / findOrFail, and the BindableModel route key behavior
// (docs/v1/database.md › Model, › BindableModel). The repository is stubbed over arrays, as Model.test.ts does.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { format } from 'mysql2'
import {
  DataSource,
  EntitySchema,
  FindOperator,
  type ColumnType,
  type SelectQueryBuilder,
  type ValueTransformer,
} from 'typeorm'
import { isException } from '@laratype/support'
import Model from '../src/eloquent/Model'
import ModelNotFoundException from '../src/exceptions/ModelNotFoundException'
import ModelQueryBuilder from '../src/eloquent/ModelQueryBuilder'

type Row = Record<string, any>

interface FakeColumn {
  readonly propertyName: string
  readonly propertyPath: string
  readonly type: ColumnType
  readonly relationMetadata?: unknown
  readonly transformer?: ValueTransformer | ValueTransformer[]
  readonly enum?: readonly (string | number)[]
}

/** An integer column whose hydrated value is "item-<n>", as an app's route key transformer does. */
const itemTransformer: ValueTransformer = {
  to: (value: unknown) => (typeof value === 'string' ? Number(value.replace('item-', '')) : value),
  from: (value: unknown) => (value === null || value === undefined ? value : `item-${value}`),
}

/** A transformer that returns an object, which a route lookup must not bind. */
const toObject: ValueTransformer = { to: () => ({ id: 1 }), from: (value: unknown) => value }

/** An identity transformer: the column's own type rule still checks what `to()` returns (CR round 3). */
const identity: ValueTransformer = { to: (value: unknown) => value, from: (value: unknown) => value }

/** A transformer that throws on the attacker-controlled path string. */
const throwingTo: ValueTransformer = {
  to: () => {
    throw new Error('transformer.to must not escape findByRouteKey()')
  },
  from: (value: unknown) => value,
}

/** A transformer that returns a Proxy whose prototype read throws: even the scalar check must not escape. */
const proxyTo: ValueTransformer = {
  to: () =>
    new Proxy({}, {
      getPrototypeOf: () => {
        throw new Error('proxy trap')
      },
    }),
  from: (value: unknown) => value,
}

/** A transformer whose hydrated value is an object, which cannot be a route key. */
const objectFrom: ValueTransformer = { to: (value: unknown) => value, from: () => ({ id: 1 }) }

const COLUMNS: FakeColumn[] = [
  { propertyName: 'id', propertyPath: 'id', type: Number },
  { propertyName: 'email', propertyPath: 'email', type: String },
  { propertyName: 'slug', propertyPath: 'slug', type: String },
  { propertyName: 'age', propertyPath: 'age', type: Number },
  { propertyName: 'isActive', propertyPath: 'isActive', type: Boolean },
  { propertyName: 'createdAt', propertyPath: 'createdAt', type: Date },
  { propertyName: 'tenantId', propertyPath: 'tenantId', type: String },
  // A time-only column: TypeORM hydrates it as a string, never a Date
  { propertyName: 'opensAt', propertyPath: 'opensAt', type: 'time' },
  // A zoned time: PostgreSQL hydrates an offset on timetz / time with time zone
  { propertyName: 'zonedTime', propertyPath: 'zonedTime', type: 'timetz' },
  { propertyName: 'zonedTimeText', propertyPath: 'zonedTimeText', type: 'time with time zone' },
  // A UUID route key: PostgreSQL rejects a malformed bind value
  { propertyName: 'externalId', propertyPath: 'externalId', type: 'uuid' },
  // A fractional route key is refused as a configuration (a canonical number string cannot round trip its scale)
  { propertyName: 'price', propertyPath: 'price', type: 'decimal' },
  { propertyName: 'ratio', propertyPath: 'ratio', type: 'float' },
  // A transformed route key: getRouteKey() emits the hydrated value, which transformer.to takes back
  { propertyName: 'serial', propertyPath: 'serial', type: Number, transformer: itemTransformer },
  // An identity transformer: the transformed value still takes the plain path's uuid / integer rule
  { propertyName: 'externalKey', propertyPath: 'externalKey', type: 'uuid', transformer: identity },
  { propertyName: 'code', propertyPath: 'code', type: Number, transformer: identity },
  // A transformer whose hydrated value is not a route key
  { propertyName: 'brokenFrom', propertyPath: 'brokenFrom', type: String, transformer: objectFrom },
  { propertyName: 'hostileRoute', propertyPath: 'hostileRoute', type: String, transformer: toObject },
  // A bigint route key: getRouteKey() may carry a bigint, while findByRouteKey() keeps the path string
  { propertyName: 'snowflake', propertyPath: 'snowflake', type: 'bigint' },
  // An int column used for the unsigned / SQLite above-2^31 regression key
  { propertyName: 'intValue', propertyPath: 'intValue', type: 'int' },
  // A date-only key: TypeORM hydrates "YYYY-MM-DD", not a Date
  { propertyName: 'birthday', propertyPath: 'birthday', type: 'date' },
  // An enum route key: PostgreSQL rejects a label outside column.enum
  { propertyName: 'status', propertyPath: 'status', type: 'enum', enum: ['draft', 'published'] },
  // An embedded column: its leaf `street` is not an own model property
  { propertyName: 'street', propertyPath: 'address.street', type: String },
  // A relation's join column: TypeORM sets relationMetadata and names it after the relation property
  { propertyName: 'author', propertyPath: 'author', type: Number, relationMetadata: {} },
]

/**
 * A model class whose repository is a slice of the TypeORM one over `rows`: `findOne` / `find` match the where
 * object by equality, and every call is recorded.
 */
const model = (options: {
  rows?: Row[]
  columns?: FakeColumn[]
  primary?: string[]
  routeKeyName?: string
  driver?: string
} = {}) => {
  const rows = options.rows ?? [{ id: 1, email: 'ada@example.com', slug: 'ada', age: 36, isActive: true }]
  const columns = options.columns ?? COLUMNS
  const primary = options.primary ?? ['id']
  const driver = options.driver ?? 'mysql'
  const findOneCalls: any[] = []
  const findCalls: any[] = []
  const raw: [string, unknown[] | undefined][] = []

  class User extends Model {
    declare id: number
    declare email: string
    declare slug: string
    declare age: number
    declare isActive: boolean
    declare createdAt: Date
    declare tenantId: string
  }
  if (options.routeKeyName !== undefined) {
    Object.defineProperty(User, 'routeKeyName', { value: options.routeKeyName })
  }

  /**
   * The value a find condition binds: a `Raw` route-key condition carries it in `objectLiteralParameters`, and any
   * other operator (an `Equal`) in `value`.
   */
  const conditionValue = (value: unknown): unknown => {
    if (!(value instanceof FindOperator)) return value
    const parameters = value.objectLiteralParameters as Row | undefined
    return parameters && 'routeKey' in parameters ? parameters.routeKey : value.value
  }
  const matches = (where: Row) => (row: Row) =>
    Object.entries(where).every(([key, value]) => row[key] === conditionValue(value))

  const repository = {
    metadata: {
      targetName: 'User',
      primaryColumns: primary.map((name) => ({ propertyName: name })),
      columns,
    },
    // routeKeyColumn() reads the driver for the time range; the stub mirrors TypeORM's repository shape
    manager: { connection: { driver: { options: { type: driver } } } },
    findOne: async (options: { where: Row }) => {
      findOneCalls.push(options)
      return rows.find(matches(options.where)) ?? null
    },
    find: async (options?: { where?: Row }) => {
      findCalls.push(options)
      return options?.where ? rows.filter(matches(options.where)) : rows
    },
    // Model.query() only wraps the builder in the facade; no lookup in this file reaches its methods
    createQueryBuilder: () => ({}),
    query: async (sql: string, parameters?: unknown[]) => {
      raw.push([sql, parameters])
      return [{ ok: 1 }]
    },
  }
  ;(User as any).getRepository = () => repository

  return { User, rows, findOneCalls, findCalls, raw }
}

describe('Model.primaryKey', () => {
  it('reads the first primary column property name from the TypeORM metadata', () => {
    const { User } = model()
    expect(User.primaryKey).toBe('id')
  })

  it('throws when the model has no primary column', () => {
    const { User } = model({ primary: [] })
    expect(() => User.primaryKey).toThrow(
      '[@laratype/database] User has no primary key: mark one column with @PrimaryColumn or @PrimaryGeneratedColumn',
    )
  })

  it('refuses a composite primary key, for a lookup that needs one key', async () => {
    const { User } = model({ primary: ['id', 'tenantId'] })
    expect(() => User.primaryKey).toThrow(
      '[@laratype/database] User has a composite primary key (id, tenantId): the v1 Model needs one primary key, so set static routeKeyName to the property a lookup uses',
    )
    await expect(User.findOrFail(1)).rejects.toThrow(
      '[@laratype/database] User has a composite primary key (id, tenantId)',
    )
  })
})

describe('Model.find and findOrFail', () => {
  it('find(id) looks the primary key up and resolves the model or null', async () => {
    const { User, findOneCalls } = model()
    await expect(User.find(1)).resolves.toMatchObject({ id: 1 })
    expect(findOneCalls).toEqual([{ where: { id: 1 } }])
    expect(await User.find(99)).toBeNull()
  })

  it('find(id) accepts a string or a bigint key as it is', async () => {
    const { User, findOneCalls } = model()
    await User.find('1')
    await User.find(1n)
    expect(findOneCalls).toEqual([{ where: { id: '1' } }, { where: { id: 1n } }])
  })

  it('find() and find(options) keep the 0.5 TypeORM list form', async () => {
    const { User, findCalls } = model()
    await expect(User.find()).resolves.toHaveLength(1)
    await expect(User.find({ where: { email: 'ada@example.com' } })).resolves.toHaveLength(1)
    expect(findCalls).toEqual([undefined, { where: { email: 'ada@example.com' } }])
  })

  it('findOrFail(id) resolves the model or throws ModelNotFoundException', async () => {
    const { User } = model()
    await expect(User.findOrFail(1)).resolves.toMatchObject({ id: 1 })

    const failure = await User.findOrFail(99).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ModelNotFoundException)
    expect((failure as ModelNotFoundException).name).toBe('ModelNotFoundException')
    expect((failure as ModelNotFoundException).message).toBe('No query results for model [User] 99')
    // What the 0.5 exception filter uses: a responsible Exception, by brand, with its 404 status
    expect(isException(failure)).toBe(true)
    expect((failure as ModelNotFoundException).canResponsible()).toBe(true)
    expect((failure as ModelNotFoundException).getHttpCode()).toBe(404)
  })

  it('refuses a non-primitive id instead of falling through to the list form', async () => {
    const ids: [unknown, string][] = [
      [{}, 'object'],
      [{ where: {} }, 'object'],
      [[1], 'array'],
      [null, 'null'],
      [true, 'boolean'],
      // A number that cannot be a key: TypeORM would bind NaN / Infinity and match nothing, or the driver rejects it
      [Number.NaN, 'non-finite number'],
      [Number.POSITIVE_INFINITY, 'non-finite number'],
      [Number.NEGATIVE_INFINITY, 'non-finite number'],
    ]
    for (const [id, type] of ids) {
      const { User, findCalls, findOneCalls } = model()
      await expect(User.findOrFail(id as never)).rejects.toThrow(
        `[@laratype/database] User.findOrFail() takes a string, number or bigint primary key, got ${type}`,
      )
      // The strict guard throws before the lookup: neither find() nor findOne() runs
      expect(findCalls).toEqual([])
      expect(findOneCalls).toEqual([])
    }
  })

  it('names a Date, and an object that only inherits Date.prototype, without calling getTime()', async () => {
    // `valueType()` reads the Date internal slot, so an object with Date.prototype is "object" and an overridden
    // getTime() is never called (a real Date subclass keeps its valid time)
    const fake = Object.create(Date.prototype) as Date
    const sneaky = new Date('2026-01-02')
    Object.defineProperty(sneaky, 'getTime', {
      value: () => {
        throw new Error('getTime() must not be called')
      },
    })
    for (const [id, type] of [
      [fake, 'object'],
      [sneaky, 'Date'],
    ] as const) {
      const { User } = model()
      await expect(User.findOrFail(id as never)).rejects.toThrow(
        `[@laratype/database] User.findOrFail() takes a string, number or bigint primary key, got ${type}`,
      )
    }
  })

  it('takes a hostile, long or unicode string key as a bound value', async () => {
    const keys = ['__proto__', 'id; DROP TABLE users', 'x'.repeat(10_000), '\uD800', 'a\u0000b']
    for (const key of keys) {
      const { User, findOneCalls } = model({ rows: [{ id: key }] })
      await expect(User.findOrFail(key)).resolves.toMatchObject({ id: key })
      // The key is a value in the where object, never SQL text
      expect(findOneCalls).toEqual([{ where: { id: key } }])
    }
  })

  it('keeps the model name and the key off the wire: the 404 body is the generic one', async () => {
    const { User } = model()
    const failure = (await User.findOrFail(99).catch((error: unknown) => error)) as ModelNotFoundException
    const body = JSON.stringify(failure.toJson())
    expect(failure.toJson()).toEqual({ code: 'NOT_FOUND', message: 'Resource not found!' })
    expect(body).not.toContain('User')
    expect(body).not.toContain('99')
  })
})

describe('Model.findByRouteKey', () => {
  const lookUp = async (key: string, options: { routeKeyName?: string } = {}) => {
    const fixture = model(options)
    const found = await fixture.User.findByRouteKey(key)
    return { ...fixture, found }
  }

  /** The value the route-key `Raw` operator binds, for a lookup over the stubbed repository. */
  const boundRouteKey = (findOneCalls: any[], property: string): unknown => {
    const condition = findOneCalls[0]!.where[property]
    expect(condition).toBeInstanceOf(FindOperator)
    return (condition as FindOperator<unknown>).objectLiteralParameters!.routeKey
  }

  it('converts an integer string to a number for the primary key', async () => {
    const { findOneCalls, found } = await lookUp('1')
    expect(found).toMatchObject({ id: 1 })
    expect(findOneCalls).toEqual([{ where: { id: 1 } }])
  })

  it('accepts a negative integer and zero', async () => {
    expect((await lookUp('-7')).findOneCalls).toEqual([{ where: { id: -7 } }])
    expect((await lookUp('0')).findOneCalls).toEqual([{ where: { id: 0 } }])
  })

  it('answers a key that cannot convert as a miss, never as a throw', async () => {
    for (const key of ['01', ' 1', '1 ', '1.0', '1.5', '1e3', '+1', '', 'abc', '9007199254740992']) {
      const { findOneCalls, found } = await lookUp(key)
      expect(found, key).toBeNull()
      expect(findOneCalls, key).toEqual([])
    }
  })

  it('keeps a uuid / string route key as it is', async () => {
    const { findOneCalls } = await lookUp('ADA', { routeKeyName: 'slug' })
    expect(findOneCalls).toEqual([{ where: { slug: 'ADA' } }])
  })

  it('converts a boolean route key from true/false and 1/0 only', async () => {
    for (const [key, value] of [
      ['true', true],
      ['1', true],
      ['false', false],
      ['0', false],
    ] as const) {
      expect((await lookUp(key, { routeKeyName: 'isActive' })).findOneCalls).toEqual([{ where: { isActive: value } }])
    }
    for (const key of ['yes', 'TRUE', '2']) {
      const { findOneCalls, found } = await lookUp(key, { routeKeyName: 'isActive' })
      expect(found, key).toBeNull()
      expect(findOneCalls, key).toEqual([])
    }
  })

  it('converts a date route key, and a date that cannot parse is a miss', async () => {
    const hit = await lookUp('2026-01-02', { routeKeyName: 'createdAt' })
    const value = hit.findOneCalls[0].where.createdAt
    expect(value).toBeInstanceOf(Date)
    expect(value.toISOString()).toBe('2026-01-02T00:00:00.000Z')

    const miss = await lookUp('not-a-date', { routeKeyName: 'createdAt' })
    expect(miss.found).toBeNull()
    expect(miss.findOneCalls).toEqual([])
  })

  it('keeps a valid time-only route key as a string and answers a malformed one as a miss', async () => {
    // TypeORM hydrates a MySQL TIME as "12:34:56"; new Date("12:34:56") is Invalid Date, so the string passes through
    const valid = [
      '12:34:56',
      '12:34',
      '0:00',
      '00:00:00',
      '24:00:00',
      '12:34:56.789',
      '12:34:56.789012',
      '12:34:56.1234567',
      '838:59:59',
      '838:59:59.000000',
      '838:59:59.0000000',
      '838:59:58.999999',
      '-838:59:59',
      '-838:59:58.999999',
      '-00:00:01',
    ]
    // PostgreSQL rejects these as a bind error; the lookup answers null before the driver parses them
    const invalid = [
      '',
      'not-a-time',
      '25:61:00',
      '12:60:00',
      '12:34:60',
      '12:34.5',
      '12:34:56.',
      '12:34:56.12345678',
      '839:00:00',
      // MySQL's TIME ends at 838:59:59.000000: a fraction past that second is out of range for either sign
      '838:59:59.999999',
      '838:59:59.000001',
      '-838:59:59.999999',
      '+12:34:56',
      '12:34:56+07',
      ' 12:34:56',
      '12:34:56 ',
      '12:34:56\n',
      '12:34:56\u0000',
      '\uD800',
      'x'.repeat(1_000_000),
    ]
    for (const driver of ['mysql', 'mariadb']) {
      for (const key of valid) {
        const { User, findOneCalls } = model({ driver, routeKeyName: 'opensAt', rows: [{ id: 1, opensAt: key }] })
        await expect(User.findByRouteKey(key), `${driver} ${key}`).resolves.toMatchObject({ id: 1 })
        expect(findOneCalls, key).toEqual([{ where: { opensAt: key } }])
      }
      for (const key of invalid) {
        const { User, findOneCalls } = model({ driver, routeKeyName: 'opensAt', rows: [{ id: 1, opensAt: '12:34:56' }] })
        await expect(User.findByRouteKey(key), `${driver} ${key.slice(0, 20)}`).resolves.toBeNull()
        expect(findOneCalls, key.slice(0, 20)).toEqual([])
      }
    }
  })

  it('uses the driver time range: MySQL 838h, PostgreSQL 24:00, SQL Server 23:59, unknown strict', async () => {
    const cases: [string, string[], string[]][] = [
      [
        'mysql',
        ['25:00:00', '-01:00:00', '838:00', '838:59:59'],
        ['839:00:00', '12:34.5', '+12:34:56'],
      ],
      [
        'postgres',
        ['00:00', '23:59:59.999999', '24:00', '24:00:00', '24:00:00.000'],
        ['24:00:01', '24:00:00.000001', '25:00:00', '-01:00:00', '838:00'],
      ],
      [
        'mssql',
        ['00:00:00', '23:59:59', '23:59:59.9999999'],
        ['24:00:00', '25:00:00', '-01:00:00', '838:00'],
      ],
      [
        'unknown',
        ['00:00:00', '23:59:59'],
        ['24:00:00', '25:00:00', '-01:00:00', '838:00'],
      ],
    ]
    for (const [driver, valid, invalid] of cases) {
      for (const key of valid) {
        const { User, findOneCalls } = model({ driver, routeKeyName: 'opensAt', rows: [{ id: 1, opensAt: key }] })
        await expect(User.findByRouteKey(key), `${driver} ${key}`).resolves.toMatchObject({ id: 1 })
        // SQL Server binds a time key through the raw form (its own test); another driver binds the plain value
        if (driver === 'mssql') {
          expect(boundRouteKey(findOneCalls, 'opensAt'), `${driver} ${key}`).toBe(key)
        } else {
          expect(findOneCalls, `${driver} ${key}`).toEqual([{ where: { opensAt: key } }])
        }
      }
      for (const key of invalid) {
        const { User, findOneCalls } = model({ driver, routeKeyName: 'opensAt', rows: [{ id: 1, opensAt: '12:34:56' }] })
        await expect(User.findByRouteKey(key), `${driver} ${key}`).resolves.toBeNull()
        expect(findOneCalls, `${driver} ${key}`).toEqual([])
      }
    }
  })

  it('binds a plain SQL Server time key in a form its driver accepts', async () => {
    // TypeORM's mssql where wrapper turns a plain string into an MssqlParameter(value, "time"); tedious's Time
    // validator runs Date.parse on that string (NaN for "12:34:56") and rejects it. The raw form keeps the exact
    // text, which SQL Server converts to time and which keeps every fractional digit.
    const key = '23:59:59.9999999'
    const { User, findOneCalls } = model({
      driver: 'mssql',
      routeKeyName: 'opensAt',
      rows: [{ id: 1, opensAt: key }],
    })
    await expect(User.findByRouteKey(key)).resolves.toMatchObject({ id: 1 })
    const condition = findOneCalls[0]!.where.opensAt
    expect(condition).toBeInstanceOf(FindOperator)
    expect((condition as FindOperator<unknown>).type).toBe('raw')
    expect((condition as FindOperator<unknown>).objectLiteralParameters).toEqual({ routeKey: key })

    // The real SqlServerDriver where-value wrapper (the point where a plain string becomes a `time` parameter)
    // leaves a raw operator alone, so the string is bound untyped instead of through the rejecting Time validator.
    const { SqlServerDriver } = await import('typeorm/driver/sqlserver/SqlServerDriver.js' as string) as any
    const driver = Object.create(SqlServerDriver.prototype)
    driver.connection = {}
    const column = { type: 'time', length: null, precision: null, scale: null }
    expect(driver.parametrizeValues(column, key).type).toBe('time')
    expect(driver.parametrizeValues(column, condition)).toBe(condition)
  })

  it('keeps a zoned time key with an offset only on a timetz / time with time zone column', async () => {
    const valid = [
      '12:34:56+07',
      '12:34:56+07:00',
      '12:34:56-07:30',
      '12:34:56.789+05:30',
      '12:34:56+00',
      '12:34:56+15:59:59',
      '24:00:00+07',
      '24:00+07',
      '24:00:00.0000000+07',
    ]
    for (const routeKeyName of ['zonedTime', 'zonedTimeText']) {
      for (const key of valid) {
        const { User, findOneCalls } = model({
          driver: 'postgres',
          routeKeyName,
          rows: [{ id: 1, [routeKeyName]: key }],
        })
        await expect(User.findByRouteKey(key), `${routeKeyName} ${key}`).resolves.toMatchObject({ id: 1 })
        expect(findOneCalls, key).toEqual([{ where: { [routeKeyName]: key } }])
      }
      for (const key of [
        '12:34:56+16',
        '12:34:56+07:60',
        '12:34:56+07:',
        '12:34:56+7',
        '12:34:56+0700',
        '12:34:56Z',
        '25:00:00+07',
        '24:00:01+07',
        '24:00:00.000001+07',
        '838:59:59+07',
        '-12:34:56+07',
      ]) {
        const { User, findOneCalls } = model({
          driver: 'postgres',
          routeKeyName,
          rows: [{ id: 1, [routeKeyName]: '12:34:56+07' }],
        })
        await expect(User.findByRouteKey(key), key).resolves.toBeNull()
        expect(findOneCalls, key).toEqual([])
      }
    }

    // Only PostgreSQL has a zoned time; another driver never accepts the offset
    for (const driver of ['mysql', 'mssql', 'unknown']) {
      for (const routeKeyName of ['zonedTime', 'zonedTimeText']) {
        const { User, findOneCalls } = model({
          driver,
          routeKeyName,
          rows: [{ id: 1, [routeKeyName]: '12:34:56+07' }],
        })
        await expect(User.findByRouteKey('12:34:56+07'), `${driver} ${routeKeyName}`).resolves.toBeNull()
        expect(findOneCalls, `${driver} ${routeKeyName}`).toEqual([])
      }
    }

    // A bare time column never carries an offset
    const { User, findOneCalls } = model({
      driver: 'postgres',
      routeKeyName: 'opensAt',
      rows: [{ id: 1, opensAt: '12:34:56' }],
    })
    await expect(User.findByRouteKey('12:34:56+07')).resolves.toBeNull()
    expect(findOneCalls).toEqual([])
  })

  it('checks a transformed time-only key against the same rule', async () => {
    const columns: FakeColumn[] = [
      ...COLUMNS,
      { propertyName: 'transformedTime', propertyPath: 'transformedTime', type: 'time', transformer: identity },
    ]
    const hit = model({ routeKeyName: 'transformedTime', columns, rows: [{ id: 1, transformedTime: '12:34:56' }] })
    await expect(hit.User.findByRouteKey('12:34:56')).resolves.toMatchObject({ id: 1 })
    expect(boundRouteKey(hit.findOneCalls, 'transformedTime')).toBe('12:34:56')

    for (const key of ['not-a-time', '25:61:00', '', '\u0000', '\uD800', 'x'.repeat(1_000_000)]) {
      const miss = model({ routeKeyName: 'transformedTime', columns, rows: [{ id: 1, transformedTime: '12:34:56' }] })
      await expect(miss.User.findByRouteKey(key), key.slice(0, 20)).resolves.toBeNull()
      expect(miss.findOneCalls, key.slice(0, 20)).toEqual([])
    }

    // The transformed path reads the same driver: PostgreSQL accepts 24:00 but not 25:00 or a negative time
    const pgHit = model({
      driver: 'postgres',
      routeKeyName: 'transformedTime',
      columns,
      rows: [{ id: 1, transformedTime: '24:00:00' }],
    })
    await expect(pgHit.User.findByRouteKey('24:00:00')).resolves.toMatchObject({ id: 1 })
    const pgMiss = model({
      driver: 'postgres',
      routeKeyName: 'transformedTime',
      columns,
      rows: [{ id: 1, transformedTime: '24:00:00' }],
    })
    await expect(pgMiss.User.findByRouteKey('25:00:00')).resolves.toBeNull()
    expect(pgMiss.findOneCalls).toEqual([])
  })

  it('binds a date-only key as its calendar string, not a local-time Date', async () => {
    const originalTz = process.env.TZ
    process.env.TZ = 'Etc/GMT+5'
    try {
      // The old path built a Date at UTC midnight; in UTC-5 its local day is the previous one
      expect(new Date('2024-01-01').getDate()).toBe(31)

      const hit = model({ routeKeyName: 'birthday', rows: [{ id: 1, birthday: '2024-01-01' }] })
      await expect(hit.User.findByRouteKey('2024-01-01')).resolves.toMatchObject({ id: 1 })
      expect(hit.findOneCalls).toEqual([{ where: { birthday: '2024-01-01' } }])

      for (const key of [
        '2023-02-29',
        '2024-02-30',
        '2024-04-31',
        '2024-13-01',
        '2024-00-10',
        '2024-1-1',
        '2024-01-01T00:00:00',
        '0000-00-00',
        '0000-01-01',
      ]) {
        const miss = model({ routeKeyName: 'birthday', rows: [{ id: 1, birthday: '2024-01-01' }] })
        await expect(miss.User.findByRouteKey(key), key).resolves.toBeNull()
        expect(miss.findOneCalls, key).toEqual([])
      }

      const leap = model({ routeKeyName: 'birthday', rows: [{ id: 1, birthday: '2024-02-29' }] })
      await expect(leap.User.findByRouteKey('2024-02-29')).resolves.toMatchObject({ id: 1 })
    } finally {
      if (originalTz === undefined) delete process.env.TZ
      else process.env.TZ = originalTz
    }
  })

  it('binds a transformed date / datetime string unchanged, not the Date the rule builds', async () => {
    const originalTz = process.env.TZ
    process.env.TZ = 'Etc/GMT+5'
    try {
      expect(new Date('2024-01-01').getDate()).toBe(31)
      const dateColumns: FakeColumn[] = [
        ...COLUMNS,
        { propertyName: 'eventDate', propertyPath: 'eventDate', type: 'date', transformer: identity },
      ]
      const dateHit = model({
        routeKeyName: 'eventDate',
        columns: dateColumns,
        rows: [{ id: 1, eventDate: '2024-01-01' }],
      })
      await expect(dateHit.User.findByRouteKey('2024-01-01')).resolves.toMatchObject({ id: 1 })
      expect(boundRouteKey(dateHit.findOneCalls, 'eventDate')).toBe('2024-01-01')

      const dateMiss = model({
        routeKeyName: 'eventDate',
        columns: dateColumns,
        rows: [{ id: 1, eventDate: '2024-01-01' }],
      })
      await expect(dateMiss.User.findByRouteKey('2024-02-30')).resolves.toBeNull()
      expect(dateMiss.findOneCalls).toEqual([])

      const datetimeColumns: FakeColumn[] = [
        ...COLUMNS,
        { propertyName: 'eventAt', propertyPath: 'eventAt', type: 'timestamp', transformer: identity },
      ]
      const datetimeHit = model({
        routeKeyName: 'eventAt',
        columns: datetimeColumns,
        rows: [{ id: 1, eventAt: '2024-01-01 00:00:00' }],
      })
      await expect(datetimeHit.User.findByRouteKey('2024-01-01 00:00:00')).resolves.toMatchObject({ id: 1 })
      // The timestamp rule validates the string, but the transformer's own string is bound, not a local-time Date
      expect(boundRouteKey(datetimeHit.findOneCalls, 'eventAt')).toBe('2024-01-01 00:00:00')
    } finally {
      if (originalTz === undefined) delete process.env.TZ
      else process.env.TZ = originalTz
    }
  })

  it('binds a transformed MySQL boolean key as the parsed boolean, keeping the string on other drivers', async () => {
    const columns: FakeColumn[] = [
      ...COLUMNS,
      { propertyName: 'flag', propertyPath: 'flag', type: Boolean, transformer: identity },
    ]
    // MySQL stores a boolean as TINYINT and compares a string numerically ('true' is 0), so the parsed boolean binds
    for (const driver of ['mysql', 'mariadb', 'aurora-mysql']) {
      const falseRow = model({
        driver,
        routeKeyName: 'flag',
        columns,
        rows: [{ id: 1, flag: false }, { id: 2, flag: true }],
      })
      await expect(falseRow.User.findByRouteKey('false'), driver).resolves.toMatchObject({ id: 1 })
      expect(boundRouteKey(falseRow.findOneCalls, 'flag'), driver).toBe(false)
      const trueRow = model({
        driver,
        routeKeyName: 'flag',
        columns,
        rows: [{ id: 1, flag: false }, { id: 2, flag: true }],
      })
      await expect(trueRow.User.findByRouteKey('true'), driver).resolves.toMatchObject({ id: 2 })
      expect(boundRouteKey(trueRow.findOneCalls, 'flag'), driver).toBe(true)
    }

    // A non-MySQL driver parses the text bind itself, so the transformer's own string stays
    for (const key of ['true', '1', 'false', '0']) {
      const postgres = model({
        driver: 'postgres',
        routeKeyName: 'flag',
        columns,
        rows: [{ id: 1, flag: true }],
      })
      await postgres.User.findByRouteKey(key)
      expect(postgres.findOneCalls, key).toHaveLength(1)
      expect(boundRouteKey(postgres.findOneCalls, 'flag'), key).toBe(key)
    }

    for (const key of ['yes', 'TRUE', '2', '__proto__', 'constructor', '1\u0000', '\uD800', 'x'.repeat(1_000_000)]) {
      const miss = model({ routeKeyName: 'flag', columns, rows: [{ id: 1, flag: true }] })
      await expect(miss.User.findByRouteKey(key), key.slice(0, 20)).resolves.toBeNull()
      expect(miss.findOneCalls, key.slice(0, 20)).toEqual([])
    }
  })

  it('keeps a transformed integer string as the transformer returned it', async () => {
    const columns: FakeColumn[] = [
      ...COLUMNS,
      { propertyName: 'codeText', propertyPath: 'codeText', type: Number, transformer: identity },
    ]
    const code = model({ routeKeyName: 'codeText', columns, rows: [{ id: 1, codeText: '42' }] })
    await expect(code.User.findByRouteKey('42')).resolves.toMatchObject({ id: 1 })
    expect(boundRouteKey(code.findOneCalls, 'codeText')).toBe('42')

    for (const key of ['042', '1e3']) {
      const miss = model({ routeKeyName: 'codeText', columns, rows: [{ id: 1 }] })
      await expect(miss.User.findByRouteKey(key), key).resolves.toBeNull()
      expect(miss.findOneCalls, key).toEqual([])
    }
  })

  it('answers an impossible calendar day in a transformed timestamp string as a miss', async () => {
    const columns: FakeColumn[] = [
      ...COLUMNS,
      { propertyName: 'eventAt', propertyPath: 'eventAt', type: 'timestamp', transformer: identity },
    ]
    // V8 normalizes 2024-02-30 to March 1, but the transformer's string is what binds, and PostgreSQL rejects it
    for (const key of [
      '2024-02-30T12:00:00Z',
      '2023-02-29 12:00:00',
      '2024-04-31T00:00:00',
      '2024-13-01 00:00:00',
      '0000-01-01T00:00:00Z',
      '2024-02-30',
      '2024-02-30T25:00:00Z',
      '\uD800',
      'x'.repeat(1_000_000),
    ]) {
      const miss = model({
        driver: 'postgres',
        routeKeyName: 'eventAt',
        columns,
        rows: [{ id: 1, eventAt: '2024-01-01 00:00:00' }],
      })
      await expect(miss.User.findByRouteKey(key), key.slice(0, 20)).resolves.toBeNull()
      expect(miss.findOneCalls, key.slice(0, 20)).toEqual([])
    }

    // Valid database text, including the leap day and a date-time with a fraction, still binds unchanged
    for (const key of ['2024-02-29 12:00:00', '2024-01-01T00:00:00.123Z', 'Jan 2, 2026 12:00:00']) {
      const hit = model({
        driver: 'postgres',
        routeKeyName: 'eventAt',
        columns,
        rows: [{ id: 1, eventAt: key }],
      })
      await expect(hit.User.findByRouteKey(key), key).resolves.toMatchObject({ id: 1 })
      expect(boundRouteKey(hit.findOneCalls, 'eventAt'), key).toBe(key)
    }
  })

  it('accepts an integer key above 2^31 on an int column and a SQLite integer key', async () => {
    // A MySQL unsigned int id can exceed 2^31; the round-4 rule only checks a canonical safe integer
    const unsigned = model({ routeKeyName: 'intValue', rows: [{ id: 1, intValue: 3_000_000_000 }] })
    await expect(unsigned.User.findByRouteKey('3000000000')).resolves.toMatchObject({ id: 1, intValue: 3_000_000_000 })
    expect(unsigned.findOneCalls).toEqual([{ where: { intValue: 3_000_000_000 } }])

    // SQLite's INTEGER is 64-bit; the unknown driver must not cap it at 2^31-1
    const sqlite = model({ driver: 'sqlite', routeKeyName: 'intValue', rows: [{ id: 1, intValue: 3_000_000_000 }] })
    await expect(sqlite.User.findByRouteKey('3000000000')).resolves.toMatchObject({ id: 1, intValue: 3_000_000_000 })
  })

  it('refuses an enum key outside column.enum', async () => {
    const hit = model({ routeKeyName: 'status', rows: [{ id: 1, status: 'draft' }] })
    await expect(hit.User.findByRouteKey('draft')).resolves.toMatchObject({ id: 1 })
    expect(hit.findOneCalls).toEqual([{ where: { status: 'draft' } }])

    const miss = model({ routeKeyName: 'status', rows: [{ id: 1, status: 'draft' }] })
    await expect(miss.User.findByRouteKey('archived')).resolves.toBeNull()
    expect(miss.findOneCalls).toEqual([])

    const columns: FakeColumn[] = [
      ...COLUMNS,
      {
        propertyName: 'transformedStatus',
        propertyPath: 'transformedStatus',
        type: 'enum',
        enum: ['draft', 'published'],
        transformer: identity,
      },
    ]
    const transformedHit = model({
      routeKeyName: 'transformedStatus',
      columns,
      rows: [{ id: 1, transformedStatus: 'published' }],
    })
    await expect(transformedHit.User.findByRouteKey('published')).resolves.toMatchObject({ id: 1 })
    expect(boundRouteKey(transformedHit.findOneCalls, 'transformedStatus')).toBe('published')

    const transformedMiss = model({
      routeKeyName: 'transformedStatus',
      columns,
      rows: [{ id: 1, transformedStatus: 'draft' }],
    })
    await expect(transformedMiss.User.findByRouteKey('archived')).resolves.toBeNull()
    expect(transformedMiss.findOneCalls).toEqual([])
  })

  it('falls back to the strict common time range when the repository has no driver', async () => {
    const { User } = model({ routeKeyName: 'opensAt', rows: [{ id: 1, opensAt: '23:59:59' }] })
    const repository = (User as any).getRepository()
    ;(User as any).getRepository = () => ({ ...repository, manager: undefined })
    // routeKeyDriver() reads the optional manager; without one it is 'unknown' and keeps 00:00:00-23:59:59
    await expect(User.findByRouteKey('23:59:59')).resolves.toMatchObject({ id: 1 })
    await expect(User.findByRouteKey('24:00:00')).resolves.toBeNull()
  })

  it('lets a canonical uuid reach the lookup and answers a malformed one as a miss', async () => {
    const id = '123E4567-E89B-12D3-A456-426614174000'
    const hit = model({ routeKeyName: 'externalId', rows: [{ id: 1, externalId: id }] })
    await expect(hit.User.findByRouteKey(id)).resolves.toMatchObject({ id: 1 })
    expect(hit.findOneCalls).toEqual([{ where: { externalId: id } }])

    // PostgreSQL rejects these as a bind error; the lookup answers null before the database parses them
    for (const key of [
      '',
      'not-a-uuid',
      '123e4567-e89b-12d3-a456-42661417400',
      '123e4567e89b12d3a456426614174000',
      `{${id}}`,
      ' 123e4567-e89b-12d3-a456-426614174000',
    ]) {
      const miss = model({ routeKeyName: 'externalId', rows: [{ id: 1, externalId: id }] })
      await expect(miss.User.findByRouteKey(key)).resolves.toBeNull()
      expect(miss.findOneCalls, key).toEqual([])
    }
  })

  it('refuses a float or decimal route key as a configuration error', async () => {
    for (const routeKeyName of ['price', 'ratio']) {
      const { User } = model({ routeKeyName })
      await expect(User.findByRouteKey('1.5')).rejects.toThrow(
        `[@laratype/database] User route key "${routeKeyName}" is a float or decimal column:`
        + ' a route key must be an integer or string column, or a column with a transformer',
      )
    }
  })

  it('converts a transformed route key through transformer.to exactly once', async () => {
    let toCalls = 0
    const counting: ValueTransformer = {
      to: (value: unknown) => {
        toCalls += 1
        return itemTransformer.to(value)
      },
      from: (value: unknown) => itemTransformer.from(value),
    }
    const { User, findOneCalls } = model({
      routeKeyName: 'counted',
      columns: [...COLUMNS, { propertyName: 'counted', propertyPath: 'counted', type: Number, transformer: counting }],
      rows: [{ id: 1, counted: 42 }],
    })
    await expect(User.findByRouteKey('item-42')).resolves.toMatchObject({ id: 1, counted: 42 })
    // The converted 42 is bound through a Raw operator; TypeORM's find form does not run to() a second time
    expect(boundRouteKey(findOneCalls, 'counted')).toBe(42)
    expect(toCalls).toBe(1)
  })

  it('checks a transformed uuid against the column type: a canonical one is found, a malformed one is a miss', async () => {
    const id = '123E4567-E89B-12D3-A456-426614174000'
    const hit = model({ routeKeyName: 'externalKey', rows: [{ id: 1, externalKey: id }] })
    await expect(hit.User.findByRouteKey(id)).resolves.toMatchObject({ id: 1 })
    expect(boundRouteKey(hit.findOneCalls, 'externalKey')).toBe(id)

    // An identity transformer used to pass these to PostgreSQL, which rejects the bind instead of answering null
    for (const key of [
      '',
      'not-a-uuid',
      '123e4567-e89b-12d3-a456-42661417400',
      '123e4567e89b12d3a456426614174000',
      `{${id}}`,
      ' 123e4567-e89b-12d3-a456-426614174000',
      `123e4567-e89b-12d3-a456-426614174000\u0000`,
    ]) {
      const miss = model({ routeKeyName: 'externalKey', rows: [{ id: 1, externalKey: id }] })
      await expect(miss.User.findByRouteKey(key)).resolves.toBeNull()
      expect(miss.findOneCalls, key).toEqual([])
    }
  })

  it('checks a transformed integer against the plain path rule, keeping the string it returned', async () => {
    for (const key of ['42', '-7', '0']) {
      const hit = model({ routeKeyName: 'code', rows: [{ id: 1, code: key }] })
      await expect(hit.User.findByRouteKey(key)).resolves.toMatchObject({ id: 1, code: key })
      expect(boundRouteKey(hit.findOneCalls, 'code')).toBe(key)
    }

    // An identity transformer used to bind these, and PostgreSQL rejects a non-canonical integer bind
    for (const key of ['01', '1.0', '1e3', '+1', ' 1', '', 'abc', '9007199254740992']) {
      const miss = model({ routeKeyName: 'code', rows: [{ id: 1, code: 42 }] })
      await expect(miss.User.findByRouteKey(key)).resolves.toBeNull()
      expect(miss.findOneCalls, key).toEqual([])
    }
  })

  it('applies the date, boolean, time and uuid rules to a transformed value already typed', async () => {
    const date = new Date('2026-01-02T00:00:00.000Z')
    const dateTo: ValueTransformer = { to: () => date, from: (value: unknown) => value }
    const dateHit = model({
      routeKeyName: 'when',
      columns: [...COLUMNS, { propertyName: 'when', propertyPath: 'when', type: 'timestamp', transformer: dateTo }],
      rows: [{ id: 1, when: date }],
    })
    await expect(dateHit.User.findByRouteKey('ignored')).resolves.toMatchObject({ id: 1 })
    expect(boundRouteKey(dateHit.findOneCalls, 'when')).toBe(date)

    const boolTo: ValueTransformer = { to: () => true, from: (value: unknown) => value }
    const boolHit = model({
      routeKeyName: 'enabled',
      columns: [...COLUMNS, { propertyName: 'enabled', propertyPath: 'enabled', type: Boolean, transformer: boolTo }],
      rows: [{ id: 1, enabled: true }],
    })
    await expect(boolHit.User.findByRouteKey('ignored')).resolves.toMatchObject({ id: 1 })
    expect(boundRouteKey(boolHit.findOneCalls, 'enabled')).toBe(true)

    // A typed value must be the column's class: none of these reach the database
    for (const [value, columnType] of [
      [42, 'timestamp'],
      ['yes', Boolean],
      [date, 'time'],
      [42, 'uuid'],
    ] as const) {
      const invalid: ValueTransformer = { to: () => value, from: (input: unknown) => input }
      const miss = model({
        routeKeyName: 'typed',
        columns: [...COLUMNS, { propertyName: 'typed', propertyPath: 'typed', type: columnType, transformer: invalid }],
      })
      await expect(miss.User.findByRouteKey('ignored')).resolves.toBeNull()
      expect(miss.findOneCalls).toEqual([])
    }
  })

  it('answers a transformer.to that throws as a miss, not a 500', async () => {
    const { User, findOneCalls } = model({
      routeKeyName: 'hostileTo',
      columns: [...COLUMNS, { propertyName: 'hostileTo', propertyPath: 'hostileTo', type: String, transformer: throwingTo }],
    })
    await expect(User.findByRouteKey('not-a-uuid')).resolves.toBeNull()
    expect(findOneCalls).toEqual([])
  })

  it('answers every other non-route-key transformer output as a miss, never as a throw', async () => {
    const cases: [string, ValueTransformer, ColumnType][] = [
      // Buffer.isBuffer() reads the Proxy's prototype, so even the scalar check can throw on hostile output
      ['a Proxy', proxyTo, String],
      ['NaN', { to: () => Number.NaN, from: (value: unknown) => value }, Number],
      ['an object', toObject, String],
      ['a 1 MB string', { to: () => 'a'.repeat(1_000_000), from: (value: unknown) => value }, 'uuid'],
      ['control characters', { to: () => '1\u0000', from: (value: unknown) => value }, Number],
    ]
    for (const [type, transformer, columnType] of cases) {
      const { User, findOneCalls } = model({
        routeKeyName: 'hostile',
        columns: [...COLUMNS, { propertyName: 'hostile', propertyPath: 'hostile', type: columnType, transformer }],
      })
      await expect(User.findByRouteKey('ada'), type).resolves.toBeNull()
      expect(findOneCalls, type).toEqual([])
    }
  })

  it('answers a non-string key from a JS caller as a miss, keeping the lookup off the database', async () => {
    for (const key of [{}, [1], null, undefined, 1, Number.NaN, Number.POSITIVE_INFINITY, { length: 1e9 }]) {
      const { User, findOneCalls } = model()
      await expect(User.findByRouteKey(key as never)).resolves.toBeNull()
      expect(findOneCalls).toEqual([])
    }
  })

  it('binds a hostile, control-character, unicode or 1 MB path string as a value', async () => {
    for (const key of ['__proto__', 'constructor', 'a\u0000b', '\uD800', 'x'.repeat(1_000_000)]) {
      const { User, findOneCalls } = model({ routeKeyName: 'slug', rows: [{ id: 1, slug: key }] })
      await expect(User.findByRouteKey(key)).resolves.toMatchObject({ id: 1 })
      expect(findOneCalls).toEqual([{ where: { slug: key } }])
    }
  })

  it('keeps a bigint route key as the string TypeORM hydrates', async () => {
    const { User, findOneCalls } = model({ routeKeyName: 'snowflake', rows: [{ id: 1, snowflake: '0' }] })
    await expect(User.findByRouteKey('0')).resolves.toMatchObject({ id: 1 })
    expect(findOneCalls).toEqual([{ where: { snowflake: '0' } }])
  })

  it('throws when routeKeyName is not a column of the model, so no caller string reaches the lookup', async () => {
    for (const routeKeyName of [
      'handle',
      'id; DROP TABLE users',
      '__proto__',
      'constructor',
      'posts',
      'street',
      'address.street',
      // A relation's join column is not an own model column
      'author',
    ]) {
      const { User } = model({ routeKeyName })
      await expect(User.findByRouteKey('ada')).rejects.toThrow(
        `[@laratype/database] User.routeKeyName ${JSON.stringify(routeKeyName)} is not a column of the model`,
      )
      // getRouteKey() refuses the same configuration instead of returning an unusable undefined
      expect(() => (Object.assign(new User(), { id: 1 }) as InstanceType<typeof User>).getRouteKey()).toThrow(
        `[@laratype/database] User.routeKeyName ${JSON.stringify(routeKeyName)} is not a column of the model`,
      )
    }
  })
})

describe('Model.findByRouteKey over a real TypeORM findOne', () => {
  /**
   * A mysql DataSource builds metadata and SQL without opening a connection (mysql2 is a devDependency). The stubbed
   * repository's `findOne` applies TypeORM's manager semantics to a real `SelectQueryBuilder`: the metadata name is
   * the alias, `take: 1` is added and eager relations are joined. It answers a row from memory, so a test can read the
   * SQL the lookup would run without a database.
   */
  const realModel = async (eager: boolean) => {
    let toCalls = 0
    const counting: ValueTransformer = {
      to: (value: unknown) => {
        toCalls += 1
        return typeof value === 'string' ? Number(value.replace('item-', '')) : value
      },
      from: (value: unknown) => (value === null || value === undefined ? value : `item-${value}`),
    }
    const Author = new EntitySchema({
      name: 'Author',
      tableName: 'author',
      columns: {
        id: { type: Number, primary: true, generated: true },
        name: { type: String },
      },
    })
    const Post = new EntitySchema({
      name: 'Post',
      tableName: 'post',
      columns: {
        id: { type: Number, primary: true, generated: true },
        serial: { type: Number, transformer: counting },
      },
      ...(eager
        ? {
            relations: {
              author: { type: 'many-to-one' as const, target: 'Author', eager: true, joinColumn: true },
            },
          }
        : {}),
    })
    const dataSource = new DataSource({
      type: 'mysql',
      host: 'localhost',
      username: 'laratype',
      password: 'laratype',
      database: 'laratype',
      entities: [Post, Author],
      synchronize: false,
    })
    // buildMetadatas is protected; the query builder needs the metadata, not a connection
    await (dataSource as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas()
    const repository = dataSource.getRepository<Row>('Post')
    const lookups: SelectQueryBuilder<Row>[] = []
    class PostModel extends Model {
      declare id: number
      static override readonly routeKeyName = 'serial'
    }
    ;(PostModel as any).getRepository = () => ({
      metadata: repository.metadata,
      manager: repository.manager,
      // EntityManager.findOne: the metadata name is the alias, and `take: 1` is added to the find options
      findOne: async (findOptions: any) => {
        const query = repository.createQueryBuilder(repository.metadata.name)
          .setFindOptions({ ...findOptions, take: 1 })
        lookups.push(query)
        return eager
          ? { id: 1, serial: 'item-42', author: { id: 7, name: 'Ada' } }
          : { id: 1, serial: 'item-42' }
      },
    })
    return { PostModel, lookups, toCalls: () => toCalls }
  }

  it('keeps the eager relation and the single-row semantics of findOne for a transformed key', async () => {
    const { PostModel, lookups, toCalls } = await realModel(true)
    await expect(PostModel.findByRouteKey('item-42')).resolves.toMatchObject({
      id: 1,
      serial: 'item-42',
      author: { id: 7, name: 'Ada' },
    })
    expect(toCalls()).toBe(1)
    expect(lookups).toHaveLength(1)

    const query = lookups[0]!
    const [sql, parameters] = query.getQueryAndParameters()
    // findOne's eager join is in the SQL, its `take: 1` is on the builder, and the Raw operator binds 42 once
    expect(sql).toContain('LEFT JOIN `author` `Post__author`')
    expect(parameters).toEqual([42])
    expect(query.expressionMap.take).toBe(1)
    expect(toCalls()).toBe(1)
  })

  it('builds the same eager-relation lookup as findOne with a plain key', async () => {
    const { PostModel, lookups } = await realModel(true)
    await PostModel.findByRouteKey('item-42')
    await PostModel.findOne({ where: { id: 1 } })
    const joinClause = (sql: string) => sql.slice(sql.indexOf(' LEFT JOIN '), sql.indexOf(' WHERE '))
    const [transformed, plain] = lookups.map((query) => query.getQueryAndParameters()[0]!)
    expect(joinClause(transformed!)).toContain('LEFT JOIN `author`')
    expect(joinClause(transformed!)).toBe(joinClause(plain!))
  })

  it('sends LIMIT 1 for a transformed route key, as findOne does', async () => {
    const { PostModel, lookups, toCalls } = await realModel(false)
    await PostModel.findByRouteKey('item-42')
    const [sql, parameters] = lookups[0]!.getQueryAndParameters()
    const formatted = format(sql, parameters)
    expect(formatted).toContain('`Post`.`serial` = 42')
    expect(formatted).toContain('LIMIT 1')
    expect(parameters).toEqual([42])
    expect(toCalls()).toBe(1)
  })
})

describe('Model.getRouteKey', () => {
  it('returns the primary key value by default', () => {
    const { User } = model()
    const user = Object.assign(new User(), { id: 7, slug: 'ada' })
    expect(user.getRouteKey()).toBe(7)
  })

  it('returns the routeKeyName value when the model sets one', () => {
    const { User } = model({ routeKeyName: 'slug' })
    const user = Object.assign(new User(), { id: 7, slug: 'ada' })
    expect(user.getRouteKey()).toBe('ada')
  })

  it('returns a boolean route key as the column declares it', () => {
    const { User } = model({ routeKeyName: 'isActive' })
    const user = Object.assign(new User(), { isActive: true })
    expect(user.getRouteKey()).toBe(true)
  })

  it('returns a long unicode slug unchanged', () => {
    const slug = '\uD800a\u0000b'.repeat(500)
    const { User } = model({ routeKeyName: 'slug' })
    const user = Object.assign(new User(), { slug })
    expect(user.getRouteKey()).toBe(slug)
  })

  it('returns a Date route key as the same Date, the type findByRouteKey() converts a path string to', () => {
    const createdAt = new Date('2026-01-02T03:04:05.678Z')
    const { User } = model({ routeKeyName: 'createdAt' })
    const user = Object.assign(new User(), { createdAt })
    expect(user.getRouteKey()).toBe(createdAt)
    // The ISO string keeps the milliseconds findByRouteKey()'s new Date(key) reads back
    expect(new Date(createdAt.toISOString()).getTime()).toBe(createdAt.getTime())
  })

  it('returns a time-only route key as the string TypeORM hydrates', () => {
    const { User } = model({ routeKeyName: 'opensAt' })
    const user = Object.assign(new User(), { opensAt: '12:34:56' })
    expect(user.getRouteKey()).toBe('12:34:56')
  })

  it('returns a date-only route key as the YYYY-MM-DD string TypeORM hydrates', () => {
    const { User } = model({ routeKeyName: 'birthday' })
    const user = Object.assign(new User(), { birthday: '2024-01-01' })
    expect(user.getRouteKey()).toBe('2024-01-01')
  })

  it('returns the hydrated value of a transformed route key', () => {
    const { User } = model({ routeKeyName: 'serial' })
    const user = Object.assign(new User(), { serial: 'item-42' })
    expect(user.getRouteKey()).toBe('item-42')
  })

  it('refuses a non-scalar value a transformer.from hydrated, with a ModelError', () => {
    // A transformer.from() can return an object; a route consumer cannot serialize it, so getRouteKey() refuses it
    const { User } = model({ routeKeyName: 'brokenFrom' })
    for (const [value, type] of [
      [{ id: 1 }, 'object'],
      [[1], 'array'],
      [Number.NaN, 'non-finite number'],
      [Number.POSITIVE_INFINITY, 'non-finite number'],
      [Buffer.from('a'), 'object'],
      [new Uint8Array([1]), 'object'],
    ] as const) {
      const user = Object.assign(new User(), { brokenFrom: value })
      expect(() => user.getRouteKey(), type).toThrow(
        `[@laratype/database] User route key "brokenFrom" is not a string, number, bigint, boolean or Date, got ${type}`,
      )
    }
  })

  it('refuses a float or decimal route key as a configuration error', () => {
    for (const routeKeyName of ['price', 'ratio']) {
      const { User } = model({ routeKeyName })
      const user = Object.assign(new User(), { price: 1.5, ratio: 1.5 })
      expect(() => user.getRouteKey()).toThrow(
        `[@laratype/database] User route key "${routeKeyName}" is a float or decimal column:`
        + ' a route key must be an integer or string column, or a column with a transformer',
      )
    }
  })

  it('throws when a partial select omits the route key, keeping 0, false and "" valid', () => {
    const { User } = model({ routeKeyName: 'slug' })
    expect(() => Object.assign(new User(), { id: 7 }).getRouteKey()).toThrow(
      '[@laratype/database] User has no route key "slug" loaded: select the column before getRouteKey()',
    )
    // A null column value is not a usable key either
    expect(() => Object.assign(new User(), { slug: null }).getRouteKey()).toThrow(
      '[@laratype/database] User has no route key "slug" loaded: select the column before getRouteKey()',
    )

    for (const [routeKeyName, value] of [['id', 0], ['isActive', false], ['slug', ''], ['snowflake', 0n]] as const) {
      const { User } = model({ routeKeyName })
      const user = Object.assign(new User(), { id: 0, isActive: false, slug: '', snowflake: 0n })
      expect(user.getRouteKey()).toBe(value)
    }
  })
})

describe('Model.query', () => {
  it('returns the typed query builder', () => {
    const { User } = model()
    expect(User.query()).toBeInstanceOf(ModelQueryBuilder)
  })

  it('keeps the 0.5 raw query(sql, parameters) form', async () => {
    const { User, raw } = model()
    await expect(User.query('SELECT 1', [1])).resolves.toEqual([{ ok: 1 }])
    expect(raw).toEqual([['SELECT 1', [1]]])
  })
})
