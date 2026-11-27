// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, JsonResource, ResourceCollection, Route, defineResource, when } from '../../src/index'

class User {
  constructor(readonly id: number, readonly name: string, readonly isAdmin = false, readonly email = `${name}@example.com`) {}
}

const UserResource = defineResource(User, (user) => ({
  id: user.id,
  name: user.name,
  email: when(user.isAdmin, user.email),
}))

describe('defineResource', () => {
  it('make maps one model with fn', () => {
    expect(UserResource.make(new User(1, 'ada'))).toEqual({ id: 1, name: 'ada' })
  })

  it('when() keeps the key when the condition holds and drops it otherwise', () => {
    expect(UserResource.make(new User(1, 'ada', true))).toEqual({ id: 1, name: 'ada', email: 'ada@example.com' })
    expect(Object.keys(UserResource.make(new User(1, 'ada')))).toEqual(['id', 'name'])
  })

  it('when() keeps a function value as it is, never calls it', () => {
    const format = vi.fn(() => 'x')
    const Fn = defineResource(User, (user) => ({ format: when(user.isAdmin, format) }))
    expect(Fn.make(new User(1, 'ada', true)).format).toBe(format)
    expect(format).not.toHaveBeenCalled()
  })

  it('keeps null, undefined and false values: only when() drops a key', () => {
    const Values = defineResource(User, () => ({ a: null, b: undefined, c: false, d: when(true, 0) }))
    expect(Values.make(new User(1, 'ada'))).toStrictEqual({ a: null, b: undefined, c: false, d: 0 })
  })

  it('collection maps every model in order, from any iterable', () => {
    const users = [new User(1, 'ada'), new User(2, 'bob', true)]
    expect(UserResource.collection(users)).toEqual([{ id: 1, name: 'ada' }, { id: 2, name: 'bob', email: 'bob@example.com' }])
    expect(UserResource.collection(new Set(users))).toHaveLength(2)
    expect(UserResource.collection([])).toEqual([])
  })

  it('paginate maps data and keeps the other fields of the page', () => {
    const page = { data: [new User(1, 'ada')], total: 3, page: 1, perPage: 1 }
    expect(UserResource.paginate(page)).toEqual({ data: [{ id: 1, name: 'ada' }], total: 3, page: 1, perPage: 1 })
    expect(page.data[0]).toBeInstanceOf(User)
  })

  it('make refuses a class instance from fn, whose getters a copy would lose', () => {
    class Dto { constructor(readonly id: number) {} }
    expect(() => defineResource(User, (user) => new Dto(user.id)).make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must return a plain object, got an instance of Dto',
    )
    expect(() => defineResource(User, () => null as any).make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must return a plain object, got null',
    )
    expect(() => defineResource(User, () => undefined as any).make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must return a plain object, got undefined',
    )
    expect(() => defineResource(User, () => 42 as any).make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must return a plain object, got 42',
    )
    expect(() => defineResource(User, () => (() => 1) as any).make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must return a plain object, got a function',
    )
    expect(() => defineResource(User, () => [] as any).make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must return a plain object, got an instance of Array',
    )
    expect(() => defineResource(User, () => Number.NaN as any).make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must return a plain object, got NaN',
    )
    expect(() => defineResource(User, () => Number.POSITIVE_INFINITY as any).make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must return a plain object, got Infinity',
    )
  })

  it('paginate refuses a paginator instance, whose getters a copy would lose', () => {
    class Paginator {
      constructor(readonly data: User[], private readonly count: number) {}
      get total() { return this.count }
    }
    expect(() => UserResource.paginate(new Paginator([], 0))).toThrow(
      '[@laratype/http] User: paginate() takes a plain page object ({ data, ...meta }), got an instance of Paginator',
    )
    expect(UserResource.paginate(Object.assign(Object.create(null), { data: [] }))).toEqual({ data: [] })
    expect(() => UserResource.paginate({ items: [] } as any)).toThrow(
      '[@laratype/http] User: paginate() takes a page whose data holds the models, got data undefined',
    )
    expect(() => UserResource.paginate({ data: { length: 1e9 } } as any)).toThrow(
      '[@laratype/http] User: paginate() takes a page whose data holds the models, got data an instance of Object',
    )
    expect(() => UserResource.paginate(null as any)).toThrow(
      '[@laratype/http] User: paginate() takes a plain page object ({ data, ...meta }), got null',
    )
    expect(() => UserResource.paginate(42 as any)).toThrow(
      '[@laratype/http] User: paginate() takes a plain page object ({ data, ...meta }), got 42',
    )
    expect(() => UserResource.paginate(Number.NaN as any)).toThrow(
      '[@laratype/http] User: paginate() takes a plain page object ({ data, ...meta }), got NaN',
    )
    expect(() => UserResource.paginate(Number.POSITIVE_INFINITY as any)).toThrow(
      '[@laratype/http] User: paginate() takes a plain page object ({ data, ...meta }), got Infinity',
    )
  })

  it('a __proto__ key stays an own key, not the prototype, on the data and the page', () => {
    const Proto = defineResource(User, () => JSON.parse('{"__proto__": {"polluted": true}}') as any)
    const out = Proto.make(new User(1, 'ada'))
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Object.keys(out)).toEqual(['__proto__'])

    const page = UserResource.paginate(JSON.parse('{"data": [], "__proto__": {"polluted": true}}'))
    expect(Object.getPrototypeOf(page)).toBe(Object.prototype)
    expect(Object.keys(page)).toEqual(['data', '__proto__'])
  })

  it('make refuses a toJSON key, which would send its result instead of the data', () => {
    const ToJson = defineResource(User, (user) => ({ id: user.id, toJSON: () => ({ id: 0 }) }) as any)
    expect(() => ToJson.make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must not return a toJSON key: JSON.stringify would send its result instead of the resource data',
    )
  })

  it('make refuses the key even when a when() would drop it: the check runs before the filter', () => {
    const Dropped = defineResource(User, () => ({ id: 1, toJSON: when(false, () => ({ id: 0 })) }) as any)
    expect(() => Dropped.make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must not return a toJSON key',
    )
  })

  it('make refuses a then key, function or plain value, which would make the data a thenable', () => {
    const ThenFn = defineResource(User, () => ({ id: 1, then: () => ({ id: 0 }) }) as any)
    expect(() => ThenFn.make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must not return a then key: it would become a thenable that the response pipeline awaits',
    )
    const ThenValue = defineResource(User, () => ({ id: 1, then: 1 }) as any)
    expect(() => ThenValue.make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must not return a then key',
    )
  })

  it('make leaves a nested toJSON to the nested object: only the top-level keys are checked', () => {
    const Nested = defineResource(User, (user) => ({ meta: { toJSON: () => ({ id: user.id }) } }))
    expect(JSON.parse(JSON.stringify(Nested.make(new User(1, 'ada'))))).toEqual({ meta: { id: 1 } })
  })

  it('make refuses a constructor key, which would send the body as text/html', () => {
    const Ctor = defineResource(User, (user) => ({ id: user.id, constructor: user.constructor }))
    expect(() => Ctor.make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must not return a constructor key: the body would be sent as text/html instead of JSON',
    )
  })

  it('collection and paginate refuse the keys through make', () => {
    const ToJson = defineResource(User, () => ({ id: 1, toJSON: () => ({ id: 0 }) }) as any)
    expect(() => ToJson.collection([new User(1, 'ada')])).toThrow('[@laratype/http] User: the resource function must not return a toJSON key')
    expect(() => ToJson.paginate({ data: [new User(1, 'ada')] })).toThrow('[@laratype/http] User: the resource function must not return a toJSON key')
    const Then = defineResource(User, () => ({ id: 1, then: () => ({ id: 0 }) }) as any)
    expect(() => Then.collection([new User(1, 'ada')])).toThrow('[@laratype/http] User: the resource function must not return a then key')
    expect(() => Then.paginate({ data: [new User(1, 'ada')] })).toThrow('[@laratype/http] User: the resource function must not return a then key')
  })

  it('make refuses a reserved key before reading any value, without invoking its getter', () => {
    const readId = vi.fn(() => 1)
    const readToJSON = vi.fn(() => () => ({ id: 0 }))
    const data = {
      get id() { return readId() },
      get toJSON() { return readToJSON() },
    }
    expect(() => defineResource(User, () => data as any).make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must not return a toJSON key',
    )
    expect(readToJSON).not.toHaveBeenCalled()
    expect(readId).not.toHaveBeenCalled()
  })

  it('make reads the own keys once, so a Proxy cannot pass the check and carry a reserved key into the copy', () => {
    const ownKeys = vi.fn(() => ['id'])
    const data = new Proxy(
      { id: 1, toJSON: () => ({ id: 0 }) },
      { ownKeys, getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) },
    )
    expect(defineResource(User, () => data as any).make(new User(1, 'ada'))).toEqual({ id: 1 })
    expect(ownKeys).toHaveBeenCalledTimes(1)
  })

  it('paginate refuses a page-level toJSON key, and checks it before mapping the models', () => {
    const mapped = vi.fn()
    const data = { *[Symbol.iterator]() { mapped(); yield new User(1, 'ada') } }
    expect(() => UserResource.paginate({ data, toJSON: () => ({ data: [] }) })).toThrow(
      '[@laratype/http] User: the page must not have a toJSON key: JSON.stringify would send its result instead of the resource data',
    )
    expect(mapped).not.toHaveBeenCalled()
  })

  it('paginate refuses a page-level constructor key, which would send the body as text/html', () => {
    expect(() => UserResource.paginate({ data: [], constructor: Array })).toThrow(
      '[@laratype/http] User: the page must not have a constructor key: the body would be sent as text/html instead of JSON',
    )
  })

  it('paginate refuses a page-level then key, function or plain value', () => {
    expect(() => UserResource.paginate({ data: [], then: () => ({ data: [] }) })).toThrow(
      '[@laratype/http] User: the page must not have a then key: it would become a thenable that the response pipeline awaits',
    )
    expect(() => UserResource.paginate({ data: [], then: 1 })).toThrow('[@laratype/http] User: the page must not have a then key')
  })

  it('paginate refuses a reserved page key without invoking its getter', () => {
    const readToJSON = vi.fn(() => () => ({ data: [] }))
    const page = { data: [] as User[], get toJSON() { return readToJSON() } }
    expect(() => UserResource.paginate(page)).toThrow('[@laratype/http] User: the page must not have a toJSON key')
    expect(readToJSON).not.toHaveBeenCalled()
  })

  it('paginate refuses a reserved key on a null-prototype page, and keeps a page symbol key', () => {
    const nullProto = Object.assign(Object.create(null), { data: [], toJSON: () => ({ data: [] }) })
    expect(() => UserResource.paginate(nullProto)).toThrow('[@laratype/http] User: the page must not have a toJSON key')

    const tag = Symbol('tag')
    const out = UserResource.paginate({ data: [new User(1, 'ada')], [tag]: 'users' })
    expect(Object.getOwnPropertySymbols(out)).toEqual([tag])
    expect(out[tag]).toBe('users')
  })

  it('skips a non-enumerable reserved key, which neither the copy nor the page spread carries', () => {
    const page = { data: [] as User[] }
    Object.defineProperty(page, 'toJSON', { value: () => ({ data: [] }) })
    expect(UserResource.paginate(page)).toEqual({ data: [] })

    const data = { id: 1 }
    Object.defineProperty(data, 'toJSON', { value: () => ({ id: 0 }) })
    expect(defineResource(User, () => data).make(new User(1, 'ada'))).toEqual({ id: 1 })
  })

  it('paginate checks every page key in one pass, a reserved one after 10k meta keys included', () => {
    const page: { data: User[]; [key: string]: unknown } = { data: [new User(1, 'ada')] }
    for (let i = 0; i < 10_000; i++) page[`k${i}`] = i
    const out = UserResource.paginate(page)
    expect(Object.keys(out)).toHaveLength(10_001)
    expect(out.k9999).toBe(9999)

    page.toJSON = () => ({ data: [] })
    expect(() => UserResource.paginate(page)).toThrow('[@laratype/http] User: the page must not have a toJSON key')
  })

  it('make keeps an own symbol key, as the output type promises', () => {
    const tag = Symbol('tag')
    const Tagged = defineResource(User, (user) => ({ id: user.id, [tag]: user.name }))
    const out = Tagged.make(new User(1, 'ada'))
    expect(Object.getOwnPropertySymbols(out)).toEqual([tag])
    expect(out[tag]).toBe('ada')
    expect(Object.keys(out)).toEqual(['id'])
  })

  it('make keeps ordinary long, unicode and control-char keys, which are not refused', () => {
    const long = `k${'x'.repeat(10_000)}`
    const Weird = defineResource(User, (user) => ({
      id: user.id,
      [long]: user.name,
      '\u0000control': 'nul',
      'lone-\uD800': 'lone',
    }))
    const out = Weird.make(new User(1, 'ada'))
    expect(out[long]).toBe('ada')
    expect(out['\u0000control']).toBe('nul')
    expect(out['lone-\uD800']).toBe('lone')
  })

  it('drops a missing value made by another copy of the module (src and dist)', () => {
    const foreign = Object.freeze({ [Symbol.for('laratype.resource.missing')]: true, toJSON: () => undefined })
    const Foreign = defineResource(User, () => ({ id: 1, gone: foreign }))
    expect(Foreign.make(new User(1, 'ada'))).toStrictEqual({ id: 1 })
  })

  it('a nested when() stays off the wire', () => {
    const Nested = defineResource(User, (user) => ({ meta: { email: when(user.isAdmin, user.email) } }))
    expect(JSON.parse(JSON.stringify(Nested.make(new User(1, 'ada'))))).toEqual({ meta: {} })
  })

  it('the resource is frozen', () => {
    expect(Object.isFrozen(UserResource)).toBe(true)
  })
})

describe('a resource through Route.api', () => {
  const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const
  const users = defineContract()({
    index: endpoint.get('/').response(anything),
    list: endpoint.get('/list').response(anything),
    show: endpoint.get('/:id').response(anything),
    legacy: endpoint.get('/legacy').response(anything),
    legacyCollection: endpoint.get('/legacy-collection').response(anything),
  })
  const appApi = defineApi({ users: { contract: users, path: '/api/users', scopes: [] } })

  class UserController extends Controller {
    index() { return UserResource.paginate({ data: [new User(1, 'ada'), new User(2, 'bob', true)], total: 2 }) }
    list() { return UserResource.collection([new User(1, 'ada')]) }
    show({ params }: { params: { id: string } }) { return UserResource.make(new User(Number(params.id), 'ada')) }
    legacy() { return new JsonResource({ id: 1 }) }
    legacyCollection() { return new ResourceCollection([{ id: 1 }]) }
  }

  const app = new Hono()
  Route.api(appApi, (r) => [r.contract(users, UserController)]).mount(app)

  it('answers the resource data as JSON', async () => {
    const show = await app.request('/api/users/7')
    expect(show.status).toBe(200)
    expect(await show.json()).toEqual({ id: 7, name: 'ada' })
    const list = await app.request('/api/users/list')
    expect(list.headers.get('content-type')).toMatch(/^application\/json/)
    expect(await list.json()).toEqual([{ id: 1, name: 'ada' }])
    expect(await (await app.request('/api/users')).json()).toEqual({
      data: [{ id: 1, name: 'ada' }, { id: 2, name: 'bob', email: 'bob@example.com' }],
      total: 2,
    })
  })

  it('a 0.5 JsonResource and ResourceCollection still serialize', async () => {
    expect(await (await app.request('/api/users/legacy')).json()).toEqual({ id: 1 })
    expect(await (await app.request('/api/users/legacy-collection')).json()).toEqual([{ id: 1 }])
  })
})
