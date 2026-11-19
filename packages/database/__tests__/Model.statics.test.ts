// The v1 Model statics over TypeORM: primaryKey, find / findOrFail, and the BindableModel route key behavior
// (docs/v1/database.md › Model, › BindableModel). The repository is stubbed over arrays, as Model.test.ts does.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import type { ColumnType, ValueTransformer } from 'typeorm'
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
}

/** An integer column whose hydrated value is "item-<n>", as an app's route key transformer does. */
const itemTransformer: ValueTransformer = {
  to: (value: unknown) => (typeof value === 'string' ? Number(value.replace('item-', '')) : value),
  from: (value: unknown) => (value === null || value === undefined ? value : `item-${value}`),
}

/** A transformer that returns an object, which a route lookup must not bind. */
const toObject: ValueTransformer = { to: () => ({ id: 1 }), from: (value: unknown) => value }

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
  // A UUID route key: PostgreSQL rejects a malformed bind value
  { propertyName: 'externalId', propertyPath: 'externalId', type: 'uuid' },
  // A fractional route key is refused as a configuration (a canonical number string cannot round trip its scale)
  { propertyName: 'price', propertyPath: 'price', type: 'decimal' },
  { propertyName: 'ratio', propertyPath: 'ratio', type: 'float' },
  // A transformed route key: getRouteKey() emits the hydrated value, which transformer.to takes back
  { propertyName: 'serial', propertyPath: 'serial', type: Number, transformer: itemTransformer },
  { propertyName: 'hostileRoute', propertyPath: 'hostileRoute', type: String, transformer: toObject },
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
} = {}) => {
  const rows = options.rows ?? [{ id: 1, email: 'ada@example.com', slug: 'ada', age: 36, isActive: true }]
  const columns = options.columns ?? COLUMNS
  const primary = options.primary ?? ['id']
  const findOneCalls: any[] = []
  const findCalls: any[] = []
  const raw: [string, unknown[] | undefined][] = []
  const routeLookups: { sql: string; parameters: Row }[] = []

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

  const matches = (where: Row) => (row: Row) => Object.entries(where).every(([key, value]) => row[key] === value)

  const repository = {
    metadata: {
      targetName: 'User',
      primaryColumns: primary.map((name) => ({ propertyName: name })),
      columns,
    },
    findOne: async (options: { where: Row }) => {
      findOneCalls.push(options)
      return rows.find(matches(options.where)) ?? null
    },
    find: async (options?: { where?: Row }) => {
      findCalls.push(options)
      return options?.where ? rows.filter(matches(options.where)) : rows
    },
    // A transformed route key binds a condition built from the metadata, bypassing TypeORM's own transformer
    createQueryBuilder: () => {
      const builder = {
        alias: 'User',
        where(sql: string, parameters: Row) {
          routeLookups.push({ sql, parameters })
          return builder
        },
        getOne: async () => rows[0] ?? null,
      }
      return builder
    },
    query: async (sql: string, parameters?: unknown[]) => {
      raw.push([sql, parameters])
      return [{ ok: 1 }]
    },
  }
  ;(User as any).getRepository = () => repository

  return { User, rows, findOneCalls, findCalls, routeLookups, raw }
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

  it('keeps a time-only route key as a string, instead of sending it to new Date()', async () => {
    // TypeORM hydrates a MySQL TIME as "12:34:56"; new Date("12:34:56") is Invalid Date, so the key must pass through
    const { User, findOneCalls } = model({
      routeKeyName: 'opensAt',
      rows: [{ id: 1, opensAt: '12:34:56' }],
    })
    await expect(User.findByRouteKey('12:34:56')).resolves.toMatchObject({ id: 1 })
    expect(findOneCalls).toEqual([{ where: { opensAt: '12:34:56' } }])
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
    const { User, routeLookups } = model({ routeKeyName: 'serial', rows: [{ id: 1, serial: 'item-42' }] })
    await expect(User.findByRouteKey('item-42')).resolves.toMatchObject({ id: 1, serial: 'item-42' })
    // A metadata-built condition binds the converted 42; TypeORM's find form would run transformer.to a second time
    expect(routeLookups).toEqual([{ sql: 'User.serial = :routeKey', parameters: { routeKey: 42 } }])
  })

  it('answers a transformer that does not return a scalar as a miss', async () => {
    const { User, routeLookups } = model({ routeKeyName: 'hostileRoute' })
    await expect(User.findByRouteKey('ada')).resolves.toBeNull()
    expect(routeLookups).toEqual([])
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

  it('returns the hydrated value of a transformed route key', () => {
    const { User } = model({ routeKeyName: 'serial' })
    const user = Object.assign(new User(), { serial: 'item-42' })
    expect(user.getRouteKey()).toBe('item-42')
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

    for (const [routeKeyName, value] of [['id', 0], ['isActive', false], ['slug', '']] as const) {
      const { User } = model({ routeKeyName })
      const user = Object.assign(new User(), { id: 0, isActive: false, slug: '' })
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
