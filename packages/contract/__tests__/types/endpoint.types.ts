// Type tests: compiled by ../typecheck.test.ts with tsc, so a broken expectation fails `vitest run`.
import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { endpoint } from '@laratype/contract'
import type { AnyEndpoint, Endpoint, ErrorDef, InferIn, InferOut, PathParams, StandardSchemaV1 } from '@laratype/contract'

declare const notFound: ErrorDef<404, { message: string }>
declare const forbidden: ErrorDef<403, { message: string }>

const query = z.object({ page: z.string().transform(Number) })
const body = z.object({ name: z.string() })
const headers = z.object({ 'x-tenant': z.string() })
const response = z.object({ id: z.number(), name: z.string() })

// --- endpoint.<method>(path)
const bare = endpoint.get('/users/:user')
expectTypeOf(bare).toEqualTypeOf<Endpoint<'get', '/users/:user'>>()
expectTypeOf(bare.__types.method).toEqualTypeOf<'get'>()
expectTypeOf(bare.__types.path).toEqualTypeOf<'/users/:user'>()
expectTypeOf(bare.__types.query).toEqualTypeOf<undefined>()
expectTypeOf(bare.__types.body).toEqualTypeOf<undefined>()
expectTypeOf(bare.__types.headers).toEqualTypeOf<undefined>()
expectTypeOf(bare.__types.response).toEqualTypeOf<undefined>()
expectTypeOf(bare.__types.status).toEqualTypeOf<200>()
expectTypeOf(bare.__types.errors).toEqualTypeOf<never>()
expectTypeOf(endpoint.post('/x').__types.method).toEqualTypeOf<'post'>()
expectTypeOf(endpoint.put('/x').__types.method).toEqualTypeOf<'put'>()
expectTypeOf(endpoint.patch('/x').__types.method).toEqualTypeOf<'patch'>()
expectTypeOf(endpoint.delete('/x').__types.method).toEqualTypeOf<'delete'>()

// --- path params
expectTypeOf(bare.__types.params).toEqualTypeOf<{ user: string }>()
expectTypeOf<PathParams<'/users/:user/posts/:post?'>>().toEqualTypeOf<{ user: string; post?: string }>()
expectTypeOf<PathParams<'/health'>>().toEqualTypeOf<{}>()

// --- full chain
const full = endpoint
  .post('/teams/:team/users')
  .query(query)
  .body(body)
  .headers(headers)
  .response(response, 201)
  .errors(notFound)
  .errors(forbidden)

type T = typeof full.__types
expectTypeOf<T['params']>().toEqualTypeOf<{ team: string }>()
expectTypeOf<T['query']>().toEqualTypeOf<typeof query>()
expectTypeOf<T['body']>().toEqualTypeOf<typeof body>()
expectTypeOf<T['headers']>().toEqualTypeOf<typeof headers>()
expectTypeOf<T['response']>().toEqualTypeOf<typeof response>()
expectTypeOf<T['status']>().toEqualTypeOf<201>()
expectTypeOf<T['errors']>().toEqualTypeOf<ErrorDef<404, { message: string }> | ErrorDef<403, { message: string }>>()
expectTypeOf<InferIn<T['query']>>().toEqualTypeOf<{ page: string }>()
expectTypeOf<InferOut<T['query']>>().toEqualTypeOf<{ page: number }>()
expectTypeOf<InferOut<T['body']>>().toEqualTypeOf<{ name: string }>()
expectTypeOf<InferOut<T['response']>>().toEqualTypeOf<{ id: number; name: string }>()
expectTypeOf<InferOut<T['headers']>>().toEqualTypeOf<{ 'x-tenant': string }>()
expectTypeOf<InferOut<undefined>>().toEqualTypeOf<undefined>()
expectTypeOf(full).toMatchTypeOf<AnyEndpoint>()

// --- builder order does not matter; a later call overrides the slot
const reordered = endpoint.post('/teams/:team/users').errors(notFound).response(response, 201).body(body)
expectTypeOf(reordered.__types.response).toEqualTypeOf<typeof response>()
expectTypeOf(reordered.__types.errors).toEqualTypeOf<ErrorDef<404, { message: string }>>()
expectTypeOf(endpoint.get('/').body(body).body(response).__types.body).toEqualTypeOf<typeof response>()

// --- response status: default 200, literal otherwise
expectTypeOf(endpoint.get('/').response(response).__types.status).toEqualTypeOf<200>()
expectTypeOf(endpoint.get('/').response(response, 204).__types.status).toEqualTypeOf<204>()

// --- several errors in one call keep each literal
const multi = endpoint.get('/').errors(notFound, forbidden)
expectTypeOf<(typeof multi.__types.errors)['status']>().toEqualTypeOf<404 | 403>()

// --- runtime def is untyped (consumers read generics from __types)
expectTypeOf(full.def.query).toEqualTypeOf<StandardSchemaV1 | undefined>()

// --- negatives
// @ts-expect-error unknown HTTP method
endpoint.head('/')
// @ts-expect-error path must be a string
endpoint.get(1)
// @ts-expect-error schemas must implement Standard Schema
endpoint.get('/').query({ page: 1 })
// @ts-expect-error schemas must implement Standard Schema
endpoint.get('/').body('nope')
// @ts-expect-error schemas must implement Standard Schema
endpoint.get('/').headers(null)
// @ts-expect-error status must be a number
endpoint.get('/').response(response, '201')
// @ts-expect-error errors must be ErrorDef
endpoint.get('/').errors({ code: 'X' })
// @ts-expect-error def is readonly
bare.def = full.def
// @ts-expect-error def fields are readonly
bare.def.path = '/x'
// @ts-expect-error unknown path param
bare.__types.params.post
expectTypeOf(bare.__types.params).not.toEqualTypeOf<{ user: string; extra: string }>()
