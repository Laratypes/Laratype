// The v1 Model statics over TypeORM: primaryKey, find / findOrFail, and the BindableModel route key behavior
// (docs/v1/database.md › Model and › BindableModel). The repository is stubbed over arrays, as Model.test.ts does.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import type { ColumnType } from 'typeorm'
import { isException } from '@laratype/support'
import Model from '../src/eloquent/Model'
import ModelNotFoundException from '../src/exceptions/ModelNotFoundException'
import ModelQueryBuilder from '../src/eloquent/ModelQueryBuilder'

type Row = Record<string, any>

interface FakeColumn {
  readonly propertyName: string
  readonly type: ColumnType
}

const COLUMNS: FakeColumn[] = [
  { propertyName: 'id', type: Number },
  { propertyName: 'email', type: String },
  { propertyName: 'slug', type: String },
  { propertyName: 'age', type: Number },
  { propertyName: 'isActive', type: Boolean },
  { propertyName: 'createdAt', type: Date },
  { propertyName: 'tenantId', type: String },
];

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
  const lookups: any[] = []
  const listLookups: any[] = []
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

  const matches = (where: Row) => (row: Row) => Object.entries(where).every(([key, value]) => row[key] === value)

  const repository = {
    metadata: {
      targetName: 'User',
      primaryColumns: primary.map((name) => ({ propertyName: name })),
      findColumnWithPropertyName: (name: string) => columns.find((column) => column.propertyName === name),
    },
    findOne: async (options: { where: Row }) => {
      lookups.push(options)
      return rows.find(matches(options.where)) ?? null
    },
    find: async (options?: { where?: Row }) => {
      listLookups.push(options)
      return options?.where ? rows.filter(matches(options.where)) : rows
    },
    createQueryBuilder: () => ({}),
    query: async (sql: string, parameters?: unknown[]) => {
      raw.push([sql, parameters])
      return [{ ok: 1 }]
    },
  }
  ;(User as any).getRepository = () => repository

  return { User, rows, lookups, listLookups, raw };
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
    const { User, lookups } = model()
    await expect(User.find(1)).resolves.toMatchObject({ id: 1 })
    expect(lookups).toEqual([{ where: { id: 1 } }])
    expect(await User.find(99)).toBeNull()
  })

  it('find(id) accepts a string or a bigint key as it is', async () => {
    const { User, lookups } = model()
    await User.find('1')
    await User.find(1n)
    expect(lookups).toEqual([{ where: { id: '1' } }, { where: { id: 1n } }])
  })

  it('find() and find(options) keep the 0.5 TypeORM list form', async () => {
    const { User, listLookups } = model()
    await expect(User.find()).resolves.toHaveLength(1)
    await expect(User.find({ where: { email: 'ada@example.com' } })).resolves.toHaveLength(1)
    expect(listLookups).toEqual([undefined, { where: { email: 'ada@example.com' } }])
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
    const { lookups, found } = await lookUp('1')
    expect(found).toMatchObject({ id: 1 })
    expect(lookups).toEqual([{ where: { id: 1 } }])
  })

  it('accepts a negative integer and zero', async () => {
    expect((await lookUp('-7')).lookups).toEqual([{ where: { id: -7 } }])
    expect((await lookUp('0')).lookups).toEqual([{ where: { id: 0 } }])
  })

  it('answers a key that cannot convert as a miss, never as a throw', async () => {
    for (const key of ['01', ' 1', '1 ', '1.0', '1.5', '1e3', '+1', '', 'abc', '9007199254740992']) {
      const { lookups, found } = await lookUp(key)
      expect(found, key).toBeNull()
      expect(lookups, key).toEqual([])
    }
  })

  it('keeps a uuid / string route key as it is', async () => {
    const { lookups } = await lookUp('ADA', { routeKeyName: 'slug' })
    expect(lookups).toEqual([{ where: { slug: 'ADA' } }])
  })

  it('converts a boolean route key from true/false and 1/0 only', async () => {
    for (const [key, value] of [
      ['true', true],
      ['1', true],
      ['false', false],
      ['0', false],
    ] as const) {
      expect((await lookUp(key, { routeKeyName: 'isActive' })).lookups).toEqual([{ where: { isActive: value } }])
    }
    for (const key of ['yes', 'TRUE', '2']) {
      const { lookups, found } = await lookUp(key, { routeKeyName: 'isActive' })
      expect(found, key).toBeNull()
      expect(lookups, key).toEqual([])
    }
  })

  it('converts a date route key, and a date that cannot parse is a miss', async () => {
    const hit = await lookUp('2026-01-02', { routeKeyName: 'createdAt' })
    const value = hit.lookups[0].where.createdAt
    expect(value).toBeInstanceOf(Date)
    expect(value.toISOString()).toBe('2026-01-02T00:00:00.000Z')

    const miss = await lookUp('not-a-date', { routeKeyName: 'createdAt' })
    expect(miss.found).toBeNull()
    expect(miss.lookups).toEqual([])
  })

  it('throws when routeKeyName is not a column of the model, so no caller string reaches the lookup', async () => {
    for (const routeKeyName of ['handle', 'id; DROP TABLE users', '__proto__', 'constructor', 'posts']) {
      const { User } = model({ routeKeyName })
      await expect(User.findByRouteKey('ada')).rejects.toThrow(
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
