// Type tests for createClient (CL1 #109): the call signatures inferred from the generated appApi.
import { describe, expectTypeOf, test } from 'vitest'
import { createClient } from '@laratype/client'
import type { Client, ClientOf, ClientResponse, HeaderValues } from '@laratype/client'
import type { ApiTypes } from '@laratype/contract'
import { appApi } from './fixtures/.laratype/api/index.gen'
import type { AppApi } from './fixtures/.laratype/api/index.gen'
import posts from './fixtures/app/api/users/[user]/posts'
import { manifest } from './fixtures/separate-fe/api'
import type { AppApi as Generated } from './fixtures/separate-fe/api'

const api = createClient(appApi)

type User = {
  id: number
  name: string
  role: 'admin' | 'member'
  address: { street: string; zip?: string }
  tags: string[]
  pair: [number, string]
  meta: Record<string, boolean>
  createdAt: string
}

describe('createClient', () => {
  test('the client follows the folder tree', () => {
    expectTypeOf(api).toEqualTypeOf<ClientOf<AppApi>>()
    expectTypeOf(api).toEqualTypeOf<Client<ApiTypes<AppApi>>>()
    expectTypeOf(api).toHaveProperty('users')
    expectTypeOf(api.users).toHaveProperty('posts')
    expectTypeOf(api.v1.health).toHaveProperty('check')
    // @ts-expect-error unknown endpoint
    void api.users.nope
  })

  test('params: every path param of the full path, folder params included; values are strings or numbers', () => {
    expectTypeOf<Parameters<typeof api.users.posts.update>[0]>().toEqualTypeOf<{
      params: { user: string | number; post: string | number }
      body: { title: string }
      headers?: HeaderValues
      signal?: AbortSignal
    }>()
  })

  test('query: optional when all its keys are; the input is then optional too', () => {
    expectTypeOf<Parameters<typeof api.users.index>>().toEqualTypeOf<
      [input?: { query?: { page?: number | undefined }; headers?: HeaderValues; signal?: AbortSignal }]
    >()
    expectTypeOf<Parameters<typeof api.users.posts.index>[0]['query']>().toEqualTypeOf<
      { q?: string | undefined; tags?: string[] | undefined } | undefined
    >()
  })

  test('body and headers: the schema input, required when it has required keys', () => {
    expectTypeOf<Parameters<typeof api.users.store>[0]>().toEqualTypeOf<{
      body: { name: string; email: string }
      headers: { 'x-tenant': string } & HeaderValues
      signal?: AbortSignal
    }>()
    expectTypeOf<Parameters<typeof api.v1.health.check>>().toEqualTypeOf<[input?: { headers?: HeaderValues; signal?: AbortSignal }]>()
  })

  test('response: the Response, with json() typed as the wire type of the response schema (Date → string)', () => {
    expectTypeOf(api.users.show).returns.toEqualTypeOf<Promise<ClientResponse<User>>>()
    expectTypeOf(api.users.index).returns.resolves.toMatchTypeOf<Response>()
    expectTypeOf<Awaited<ReturnType<Awaited<ReturnType<typeof api.users.index>>['json']>>>().toEqualTypeOf<User[]>()
    expectTypeOf<Awaited<ReturnType<Awaited<ReturnType<typeof api.v1.health.check>>['json']>>>().toEqualTypeOf<{ ok: boolean }>()
  })

  test('errors: missing or wrong inputs', () => {
    // @ts-expect-error the input is required: params and body
    void api.users.posts.update()
    // @ts-expect-error a missing required param
    void api.users.posts.update({ params: { user: 1 }, body: { title: 'T' } })
    // @ts-expect-error a missing required folder param
    void api.users.posts.index({ params: {} })
    // @ts-expect-error unknown param
    void api.users.show({ params: { user: 1, post: 2 } })
    // @ts-expect-error param values are strings or numbers
    void api.users.show({ params: { user: true } })
    // @ts-expect-error the body must match the schema input
    void api.users.posts.update({ params: { user: 1, post: 2 }, body: { title: 1 } })
    // @ts-expect-error a required header from the headers schema
    void api.users.store({ body: { name: 'Ada', email: 'a@b.c' } })
    // @ts-expect-error no body on an endpoint without a body schema
    void api.users.index({ body: {} })
  })

  test('a hand-made object of API nodes is named after its own keys', () => {
    const picked = createClient({ posts: appApi.users.posts })
    expectTypeOf(picked.posts.update).toEqualTypeOf(api.users.posts.update)
    // @ts-expect-error the runtime names follow the keys too, not the nodes' full names
    void picked.users
  })

  test('an API node or a single contract', () => {
    const node = createClient(appApi.users.posts)
    expectTypeOf(node.update).toEqualTypeOf(api.users.posts.update)
    // a contract alone: its own relative path, so only its own params
    const contract = createClient(posts)
    expectTypeOf<Parameters<typeof contract.update>[0]['params']>().toEqualTypeOf<{ post: string | number }>()
  })
})

describe('createClient(manifest)', () => {
  const sep = createClient<Generated>(manifest)

  test('typed by the generated AppApi', () => {
    expectTypeOf(sep).toEqualTypeOf<Client<Generated>>()
    expectTypeOf<Parameters<typeof sep.users.posts.update>[0]>().toEqualTypeOf<{
      params: { user: string | number; post: string | number }
      body: { title: string }
      headers?: HeaderValues
      signal?: AbortSignal
    }>()
    expectTypeOf(sep.users.show).returns.toEqualTypeOf<Promise<ClientResponse<User>>>()
    // the same calls as the client built from appApi, apart from the fixtures' extra headers/query
    expectTypeOf(sep.users.posts.update).toEqualTypeOf(api.users.posts.update)
    expectTypeOf(sep.v1.health.check).toEqualTypeOf(api.v1.health.check)
  })

  test('errors', () => {
    // @ts-expect-error a missing required param
    void sep.users.show({ params: {} })
    // @ts-expect-error without the AppApi type argument the client is never
    void createClient(manifest).users
  })
})
