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

  it('when() calls a function value only when the condition holds', () => {
    const secret = vi.fn(() => 's3cret')
    const Secret = defineResource(User, (user) => ({ secret: when(user.isAdmin, secret) }))
    expect(Secret.make(new User(1, 'ada'))).toEqual({})
    expect(secret).not.toHaveBeenCalled()
    expect(Secret.make(new User(1, 'ada', true))).toEqual({ secret: 's3cret' })
    expect(secret).toHaveBeenCalledOnce()
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

  it('a __proto__ key stays an own key, not the prototype', () => {
    const Proto = defineResource(User, () => JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>)
    const out = Proto.make(new User(1, 'ada'))
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    expect(Object.keys(out)).toEqual(['__proto__'])
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
    show: endpoint.get('/:id').response(anything),
    legacy: endpoint.get('/legacy').response(anything),
    legacyCollection: endpoint.get('/legacy-collection').response(anything),
  })
  const appApi = defineApi({ users: { contract: users, path: '/api/users', scopes: [], dirs: [] } })

  class UserController extends Controller {
    index() { return UserResource.paginate({ data: [new User(1, 'ada'), new User(2, 'bob', true)], total: 2 }) }
    show(req: { param(key: string): string }) { return UserResource.make(new User(Number(req.param('id')), 'ada')) }
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
