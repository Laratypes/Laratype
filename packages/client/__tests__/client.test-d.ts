// Type tests for createClient (CL1 #109), the result union (CL2 #110) and the JSON-safe input (CL7 #255), inferred from the generated appApi.
import { describe, expectTypeOf, test } from 'vitest'
import * as z from 'zod'
import { createClient } from '@laratype/client'
import type { CallInput, Client, ClientOf, ClientResult, ClientSuccess, HeaderValues, ProvidedHeaders, ResponseData, UnexpectedResult } from '@laratype/client'
import { defineContract, endpoint } from '@laratype/contract'
import type { ApiTypes } from '@laratype/contract'
import { appApi } from './fixtures/.laratype/api/index.gen'
import type { AppApi } from './fixtures/.laratype/api/index.gen'
import posts from './fixtures/app/api/users/[user]/posts'
import usersContract from './fixtures/app/api/users'
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

  test('success: data is the wire type of the response schema (Date → string)', () => {
    type Show = Awaited<ReturnType<typeof api.users.show>>
    expectTypeOf<Extract<Show, { ok: true }>>().toEqualTypeOf<ClientSuccess<ApiTypes<AppApi>['users']['show']>>()
    expectTypeOf<Extract<Show, { ok: true }>['data']>().toEqualTypeOf<User>()
    expectTypeOf<Extract<Show, { ok: true }>['status']>().toEqualTypeOf<200>()
    expectTypeOf<Extract<Awaited<ReturnType<typeof api.users.store>>, { ok: true }>['status']>().toEqualTypeOf<201>()
    expectTypeOf<Extract<Awaited<ReturnType<typeof api.users.index>>, { ok: true }>['data']>().toEqualTypeOf<User[]>()
    expectTypeOf<Extract<Awaited<ReturnType<typeof api.v1.health.check>>, { ok: true }>['data']>().toEqualTypeOf<{ ok: boolean }>()
    expectTypeOf(api.users.show).returns.toEqualTypeOf<Promise<ClientResult<ApiTypes<AppApi>['users']['show']>>>()
  })

  test('narrowing by ok, then code, gives the body of that error', async () => {
    const result = await api.users.store({ body: { name: 'Ada', email: 'a@b.c' }, headers: { 'x-tenant': 't' } })
    if (result.ok) {
      expectTypeOf(result.data).toEqualTypeOf<User>()
      return
    }
    // @ts-expect-error data needs ok: true
    void result.data
    // @ts-expect-error a field of one error's body needs its code
    void result.error.email
    // the declared codes, from capabilities across all levels plus throws, and the unexpected variant
    expectTypeOf(result.code).toEqualTypeOf<'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'TOO_MANY_REQUESTS' | 'EMAIL_TAKEN' | undefined>()
    if (result.code === 'EMAIL_TAKEN') {
      expectTypeOf(result.status).toEqualTypeOf<409>()
      expectTypeOf(result.error).toEqualTypeOf<{ message: string; email: string }>()
    } else if (result.code === 'VALIDATION_ERROR') {
      expectTypeOf(result.status).toEqualTypeOf<422>()
      expectTypeOf(result.error).toEqualTypeOf<{ errors: Record<string, string[]>; message: string }>()
    } else if (result.code === undefined) {
      expectTypeOf(result).toEqualTypeOf<UnexpectedResult>()
      expectTypeOf(result.error).toEqualTypeOf<unknown>()
      expectTypeOf(result.response).toEqualTypeOf<Response | undefined>()
    }
  })

  test('two errors with the same status (403) are told apart by code, not status', async () => {
    const result = await api.users.posts.update({ params: { user: 1, post: 2 }, body: { title: 'T' } })
    if (result.ok || result.unexpected) return
    expectTypeOf(result.code).toEqualTypeOf<
      'VALIDATION_ERROR' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'TOO_MANY_REQUESTS' | 'ACCOUNT_LOCKED'
    >()
    if (result.status === 403) {
      // status alone leaves both 403s
      expectTypeOf(result.code).toEqualTypeOf<'FORBIDDEN' | 'ACCOUNT_LOCKED'>()
    }
    if (result.code === 'ACCOUNT_LOCKED') {
      expectTypeOf(result.status).toEqualTypeOf<403>()
      expectTypeOf(result.error).toEqualTypeOf<{ message: string }>()
    }
    expectTypeOf(result.response).toEqualTypeOf<Response>()
  })

  test('an endpoint without declared errors: success or unexpected only', async () => {
    const result = await api.v1.health.check()
    if (!result.ok) expectTypeOf(result).toEqualTypeOf<UnexpectedResult>()
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

  test('only the four inputs type-check: the appApi root, an API node, a contract or the manifest', () => {
    // @ts-expect-error a hand-made object: the node's own name ("users.posts") is not its key
    createClient({ posts: appApi.users.posts })
    // @ts-expect-error a contract inside an object
    createClient({ users: usersContract })
    // @ts-expect-error a single endpoint
    createClient(usersContract.show)
    // @ts-expect-error anything else
    createClient({ nope: 1 })
    // a subset of the root's own nodes keeps the root shape
    expectTypeOf(createClient({ users: appApi.users }).users.show).toEqualTypeOf(api.users.show)
  })

  test('a single contract declares the errors of its own options, as the runtime does', async () => {
    // users: { auth: true } on the contract, store throws EmailTaken; no folder scopes alone
    const result = await createClient(usersContract).store({ body: { name: 'A', email: 'a' }, headers: { 'x-tenant': 't' } })
    if (!result.ok && !result.unexpected) {
      expectTypeOf(result.code).toEqualTypeOf<'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'EMAIL_TAKEN'>()
    }
  })

  test('an API node or a single contract', () => {
    const node = createClient(appApi.users.posts)
    expectTypeOf(node.update).toEqualTypeOf(api.users.posts.update)
    // a contract alone: its own relative path, so only its own params
    const contract = createClient(posts)
    expectTypeOf<Parameters<typeof contract.update>[0]['params']>().toEqualTypeOf<{ post: string | number }>()
  })
})

describe('data of a success', () => {
  type Shape<Response, Status extends number> = {
    method: 'delete'; path: '/'; params: {}; query: undefined; body: undefined; headers: undefined
    response: Response; status: Status; errors: never
  }
  test('undefined without a response schema or for a declared 204', () => {
    expectTypeOf<ResponseData<Shape<undefined, 200>>>().toEqualTypeOf<undefined>()
    expectTypeOf<ResponseData<Shape<null, 204>>>().toEqualTypeOf<undefined>()
    expectTypeOf<ResponseData<Shape<{ ok: boolean }, 200>>>().toEqualTypeOf<{ ok: boolean }>()
  })
})

describe('wire type of the response (Jsonify)', () => {
  test('a property that may be undefined is optional, since JSON.stringify drops it', () => {
    type Wire = ResponseData<{
      method: 'get'; path: '/'; params: {}; query: undefined; body: undefined; headers: undefined; status: 200; errors: never
      response: { a: string; b: string | undefined; c?: number; d: undefined; e: () => void; f: Date | undefined; g: Record<string, boolean> }
    }>
    expectTypeOf<Wire>().toEqualTypeOf<{ a: string; b?: string; c?: number; f?: string; g: Record<string, boolean> }>()
  })
})

describe('JSON-safe request input (#255)', () => {
  type Shape<Body, Query = undefined> = {
    method: 'post'; path: '/'; params: {}; query: Query; body: Body; headers: undefined
    response: undefined; status: 204; errors: never
  }

  test('body: what JSON carries; a Date is passed as itself or its ISO string', () => {
    type Body = CallInput<Shape<{
      at: Date; n: number; tags: Date[]; pair: [Date, string]; nested: { d?: Date; s: string | null }; any: unknown
    }>>['body']
    expectTypeOf<Body>().toEqualTypeOf<{
      at: Date | string; n: number; tags: (Date | string)[]; pair: [Date | string, string]; nested: { d?: Date | string; s: string | null }; any: unknown
    }>()
  })

  test('body: a value JSON cannot carry is never, so the call is a type error', () => {
    type Body = CallInput<Shape<{ big: bigint; map: Map<string, string>; set: Set<string>; fn: () => void; maybe?: bigint; items: (string | undefined)[] }>>['body']
    // an undefined array item is sent as null
    expectTypeOf<Body>().toEqualTypeOf<{ big: never; map: never; set: never; fn: never; maybe?: undefined; items: string[] }>()
  })

  test('query: a Date is passed as itself or its ISO string, as buildUrl sends it; the rest is the schema input', () => {
    type Query = CallInput<Shape<undefined, { from?: Date; days: Date[]; big: bigint; page?: number }>>['query']
    expectTypeOf<Query>().toEqualTypeOf<{ from?: Date | string; days: (Date | string)[]; big: bigint; page?: number }>()
  })

  test('a contract whose date field coerces: the call takes a Date or an ISO string, not a number', () => {
    const events = defineContract()({
      store: endpoint.post('/api/events').body(z.object({ at: z.coerce.date(), name: z.string() })).query(z.object({ since: z.coerce.date().optional() })),
      big: endpoint.post('/api/big').body(z.object({ n: z.bigint() })),
    })
    const client = createClient(events)
    void client.store({ body: { at: new Date(), name: 'launch' }, query: { since: new Date() } })
    void client.store({ body: { at: '2026-10-22T10:00:00.000Z', name: 'launch' }, query: { since: '2026-10-01' } })
    // @ts-expect-error a number is not a Date or its JSON form
    void client.store({ body: { at: 1, name: 'launch' } })
    // @ts-expect-error JSON cannot carry a bigint (JSON.stringify throws)
    void client.big({ body: { n: 1n } })
  })

  test('a body JSON cannot carry at all is never and stays required, so the call is a type error', () => {
    const maps = defineContract()({ store: endpoint.post('/api/maps').body(z.map(z.string(), z.string())) })
    const client = createClient(maps)
    expectTypeOf<Parameters<typeof client.store>>().toEqualTypeOf<[input: { body: never; headers?: HeaderValues; signal?: AbortSignal }]>()
    // @ts-expect-error the body can't be left out
    void client.store()
  })
})

describe('headers that options.headers provides (#255)', () => {
  test('are optional in the call; the others stay required', () => {
    const provided = createClient(appApi, { headers: { 'x-tenant': 't1', authorization: 'Bearer t' } })
    expectTypeOf<Parameters<typeof provided.users.store>[0]['headers']>().toEqualTypeOf<({ 'x-tenant'?: string } & HeaderValues) | undefined>()
    void provided.users.store({ body: { name: 'Ada', email: 'a@b.c' } })
    void provided.users.store({ body: { name: 'Ada', email: 'a@b.c' }, headers: { 'x-tenant': 't2' } })
    // header names are case-insensitive
    void createClient(appApi, { headers: { 'X-Tenant': 't1' } }).users.store({ body: { name: 'Ada', email: 'a@b.c' } })
    // an API node and a contract too
    void createClient(appApi.users, { headers: { 'x-tenant': 't1' } }).store({ body: { name: 'Ada', email: 'a@b.c' } })
    void createClient(usersContract, { headers: { 'x-tenant': 't1' } }).store({ body: { name: 'Ada', email: 'a@b.c' } })
    // other headers leave it required
    // @ts-expect-error x-tenant is still required
    void createClient(appApi, { headers: { authorization: 'Bearer t' } }).users.store({ body: { name: 'Ada', email: 'a@b.c' } })
  })

  test('only the literal names an object always sends: a Headers, an array or a Record<string, string> provides none', () => {
    const record: Record<string, string> = { 'x-tenant': 't1' }
    expectTypeOf(createClient(appApi, { headers: record })).toEqualTypeOf(api)
    const pattern: Record<`x-${string}`, string> = {}
    expectTypeOf(createClient(appApi, { headers: pattern })).toEqualTypeOf(api)
    // a key that may be missing: optional, or in only one member of a union
    expectTypeOf<ProvidedHeaders<{ 'x-tenant'?: string; authorization: string }>>().toEqualTypeOf<{ authorization: string }>()
    expectTypeOf<ProvidedHeaders<{ 'x-tenant': string } | { authorization: string }>>().toEqualTypeOf<{}>()
    expectTypeOf<ProvidedHeaders<{ 'x-tenant': string } | { 'x-tenant': string; authorization: string }>>().toEqualTypeOf<{ 'x-tenant': string }>()
    // an index signature next to literal keys keeps them
    expectTypeOf<ProvidedHeaders<{ [k: string]: string; 'x-tenant': string }>>().toEqualTypeOf<{ 'x-tenant': string }>()
    const either = (headers: { 'x-tenant': string } | { authorization: string }) => createClient(appApi, { headers })
    expectTypeOf(either).returns.toEqualTypeOf(api)
    expectTypeOf(createClient(appApi, { headers: new Headers({ 'x-tenant': 't1' }) })).toEqualTypeOf(api)
    expectTypeOf(createClient(appApi, { headers: [['x-tenant', 't1']] })).toEqualTypeOf(api)
    expectTypeOf(createClient(appApi, { baseUrl: 'https://example.com' })).toEqualTypeOf(api)
  })

  test('the manifest client takes the headers type as its second type argument, checked against options.headers', () => {
    type Store = {
      method: 'post'; path: '/api/keys'; params: {}; query: undefined; body: undefined; headers: { 'x-api-key': string }
      response: undefined; status: 204; errors: never
    }
    type Generated = { keys: { store: Store } }
    const keyed = createClient<Generated, { 'x-api-key': string }>(manifest, { headers: { 'x-api-key': 'k' } })
    void keyed.keys.store()
    // @ts-expect-error the headers must send what the type argument names
    void createClient<Generated, { 'x-api-key': string }>(manifest, { headers: { authorization: 'a' } })
    // other headers may be sent too
    void createClient<Generated, { 'x-api-key': string }>(manifest, { headers: { 'x-api-key': 'k', 'accept-language': 'en' } }).keys.store()
    // @ts-expect-error and they are required
    void createClient<Generated, { 'x-api-key': string }>(manifest)
    // @ts-expect-error even with other options
    void createClient<Generated, { 'x-api-key': string }>(manifest, {})
    // @ts-expect-error without it the header stays required
    void createClient<Generated>(manifest, { headers: { 'x-api-key': 'k' } }).keys.store()
  })

  test('a provided value the schema rejects leaves the header required', () => {
    const versioned = defineContract()({ v: endpoint.get('/api/v').headers(z.object({ 'x-version': z.literal('2') })) })
    void createClient(versioned, { headers: { 'x-version': '2' as const } }).v()
    // @ts-expect-error '1' is not the '2' the schema accepts
    void createClient(versioned, { headers: { 'x-version': '1' as const } }).v()
    // @ts-expect-error nor is any string
    void createClient(versioned, { headers: { 'x-version': String(2) } }).v()
  })

  test('options are still checked', () => {
    // @ts-expect-error a header value is a string
    createClient(appApi, { headers: { 'x-tenant': 1 } })
    // @ts-expect-error an unknown option
    createClient(appApi, { nope: 1 })
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
    expectTypeOf<Extract<Awaited<ReturnType<typeof sep.users.show>>, { ok: true }>['data']>().toEqualTypeOf<User>()
    // the same calls as the client built from appApi, apart from the fixtures' extra headers/query
    expectTypeOf(sep.users.posts.update).toEqualTypeOf(api.users.posts.update)
    expectTypeOf(sep.v1.health.check).toEqualTypeOf(api.v1.health.check)
  })

  test('the result union narrows the same way', async () => {
    const result = await sep.users.posts.update({ params: { user: 1, post: 2 }, body: { title: 'T' } })
    if (!result.ok && result.code === 'ACCOUNT_LOCKED') expectTypeOf(result.error).toEqualTypeOf<{ message: string }>()
    if (!result.ok && result.code === 'VALIDATION_ERROR') expectTypeOf(result.error.errors).toEqualTypeOf<Record<string, string[]>>()
  })

  test('errors', () => {
    // @ts-expect-error a missing required param
    void sep.users.show({ params: {} })
    // @ts-expect-error without the AppApi type argument the client is never
    void createClient(manifest).users
  })
})
