import { describe, expect, it } from 'vitest'
import * as z from 'zod'
import {
  CONTRACT_NAME,
  apiEndpoint,
  apiRoutes,
  contractEndpoints,
  contractName,
  defineApi,
  defineContract,
  endpoint,
  errors,
  isContract,
  routeName,
} from '@laratype/contract'
import { appApi } from './fixtures/app/contracts'
import { posts } from './fixtures/app/contracts/posts'
import { users } from './fixtures/app/contracts/users'

describe('defineContract', () => {
  it('keeps the endpoints and brands the name with a non-enumerable symbol', () => {
    expect(users.show).toBeDefined()
    expect(users.show.def).toMatchObject({ method: 'get', path: '/users/:user', errors: [errors.notFound] })
    expect(users[CONTRACT_NAME]).toBe('users')
    expect(contractName(users)).toBe('users')
    expect(Object.keys(users)).toEqual(['index', 'show', 'store', 'destroy'])
    expect(Object.getOwnPropertyDescriptor(users, CONTRACT_NAME)?.enumerable).toBe(false)
    expect(isContract({ ...users })).toBe(false)
  })

  it('is frozen and has a null prototype', () => {
    expect(Object.isFrozen(users)).toBe(true)
    expect(Object.getPrototypeOf(users)).toBeNull()
    expect(() => {
      (users as Record<string, unknown>).extra = endpoint.get('/x')
    }).toThrow(TypeError)
  })

  it('keeps the 200 default when .response() ends the chain (NoInfer regression)', () => {
    expect(users.index.def.status).toBe(200)
    expect(posts.index.def.status).toBe(200)
    expect(users.store.def.status).toBe(201)
  })

  it('lists endpoints in definition order', () => {
    expect(contractEndpoints(posts)).toEqual([
      ['index', posts.index],
      ['store', posts.store],
    ])
  })

  it.each([[''], ['.users'], ['users.'], ['a..b']])('rejects the invalid name %j', (name) => {
    expect(() => defineContract(name, {})).toThrow(/invalid contract name/)
  })

  it('rejects endpoint keys containing "." and non-endpoint values', () => {
    expect(() => defineContract('x', { 'a.b': endpoint.get('/') })).toThrow(/must not contain "."/)
    expect(() => defineContract('x', { a: { def: {} } as never })).toThrow(/"a" is not an endpoint/)
  })

  it('accepts dotted contract names', () => {
    const admin = defineContract('admin.users', { show: endpoint.get('/admin/users/:user') })
    expect(routeName(admin, 'show')).toBe('admin.users.show')
  })
})

describe('isContract', () => {
  it('detects branded contracts only', () => {
    expect(isContract(users)).toBe(true)
    expect(isContract({ show: users.show })).toBe(false)
    expect(isContract(null)).toBe(false)
    expect(isContract('users')).toBe(false)
  })
})

describe('route registry naming', () => {
  it('names routes `<contract>.<endpoint>`', () => {
    expect(routeName(users, 'show')).toBe('users.show')
    expect(apiRoutes(appApi).map(([name]) => name)).toEqual([
      'users.index',
      'users.show',
      'users.store',
      'users.destroy',
      'posts.index',
      'posts.store',
    ])
    expect(apiRoutes(appApi)[1]![1]).toBe(users.show)
  })

  it('resolves endpoints by registry name', () => {
    expect(apiEndpoint(appApi, 'posts.store')).toBe(posts.store)
    const admin = defineContract('admin.users', { show: endpoint.get('/admin/users/:user') })
    const api = defineApi({ 'admin.users': admin })
    expect(apiEndpoint(api, 'admin.users.show')).toBe(admin.show)
  })

  it('throws on an unknown registry name', () => {
    expect(() => apiEndpoint(appApi, 'users.nope' as never)).toThrow(/unknown route name "users.nope"/)
    expect(() => apiEndpoint(appApi, 'nope' as never)).toThrow(/unknown route name "nope"/)
  })
})

describe('defineApi', () => {
  it('keeps the contracts by name, frozen', () => {
    expect(appApi.users).toBe(users)
    expect(appApi.posts).toBe(posts)
    expect(Object.keys(appApi)).toEqual(['users', 'posts'])
    expect(Object.isFrozen(appApi)).toBe(true)
  })

  it('requires each key to match the contract name', () => {
    expect(() => defineApi({ people: users } as never)).toThrow(/key "people" must match the contract name "users"/)
  })

  it('rejects non-contract values', () => {
    expect(() => defineApi({ users: { show: users.show } } as never)).toThrow(/"users" is not a contract/)
  })

  it('carries what a value-import client needs: method, path, error codes and the schemas', async () => {
    const store = apiEndpoint(appApi, 'users.store').def
    expect([store.method, store.path, store.status, store.errors.map((e) => e.status)]).toEqual(['post', '/users', 201, [422]])
    const checked = await store.body!['~standard'].validate({ name: '', email: 'nope' })
    expect(checked.issues?.length).toBe(2)
    const ok = await store.body!['~standard'].validate({ name: 'Ada', email: 'ada@example.com' })
    expect(ok).toEqual({ value: { name: 'Ada', email: 'ada@example.com' } })
  })

  it('works with an inline contract and schema', () => {
    const api = defineApi({ health: defineContract('health', { check: endpoint.get('/health').response(z.object({ ok: z.boolean() })) }) })
    expect(apiEndpoint(api, 'health.check').def.status).toBe(200)
  })
})
