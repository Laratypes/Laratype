// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { beforeAll, describe, expect, it, vi } from 'vitest'
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
    expect(() => defineResource(User, () => (() => 1) as any).make(new User(1, 'ada'))).toThrow(
      '[@laratype/http] User: the resource function must return a plain object, got a function',
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
  })

  it('a __proto__ key stays an own key, not the prototype', () => {
    const Proto = defineResource(User, () => JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>)
    const out = Proto.make(new User(1, 'ada'))
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Object.keys(out)).toEqual(['__proto__'])
  })

  it('make keeps an own symbol key, as the output type promises', () => {
    const tag = Symbol('tag')
    const Tagged = defineResource(User, (user) => ({ id: user.id, [tag]: user.name }))
    const out = Tagged.make(new User(1, 'ada'))
    expect(Object.getOwnPropertySymbols(out)).toEqual([tag])
    expect(out[tag]).toBe('ada')
    expect(Object.keys(out)).toEqual(['id'])
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

  beforeAll(() => {
    // RequestKernel.boot() sets this in an app; the router runs the 0.5 kernel until H2/H3
    globalThis.__laratype_route_model_bindings = {}
  })

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
