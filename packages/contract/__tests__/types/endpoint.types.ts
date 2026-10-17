// Type tests: compiled by ../typecheck.test.ts with tsc, so a broken expectation fails `vitest run`.
import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { defineError, endpoint } from '@laratype/contract'
import type { AnyEndpoint, DefaultCaps, Endpoint, InferIn, InferOut, PathParams, StandardSchemaV1 } from '@laratype/contract'

const notFound = defineError(404, 'POST_NOT_FOUND')
const forbidden = defineError(403, 'NOT_OWNER')

const query = z.object({ page: z.string().transform(Number) })
const body = z.object({ name: z.string() })
const headers = z.object({ 'x-tenant': z.string() })
const response = z.object({ id: z.number(), name: z.string() })

// --- endpoint.<method>(path)
const bare = endpoint.get('/users/:user')
expectTypeOf(bare).toEqualTypeOf<Endpoint<'get', '/users/:user', undefined, undefined, undefined, undefined, 204>>()
expectTypeOf(bare.__types.method).toEqualTypeOf<'get'>()
expectTypeOf(bare.__types.path).toEqualTypeOf<'/users/:user'>()
expectTypeOf(bare.__types.query).toEqualTypeOf<undefined>()
expectTypeOf(bare.__types.body).toEqualTypeOf<undefined>()
expectTypeOf(bare.__types.headers).toEqualTypeOf<undefined>()
expectTypeOf(bare.__types.response).toEqualTypeOf<undefined>()
expectTypeOf(bare.__types.status).toEqualTypeOf<204>() // no response schema: 204 (http.md › Response from the contract)
expectTypeOf(bare.__types.throws).toEqualTypeOf<never>()
expectTypeOf(bare.__types.caps).toEqualTypeOf<DefaultCaps>()
expectTypeOf<DefaultCaps>().toEqualTypeOf<{ auth: undefined; authorize: undefined; throttle: undefined }>()
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
  .throws(notFound)
  .throws(forbidden)

type T = typeof full.__types
expectTypeOf<T['params']>().toEqualTypeOf<{ team: string }>()
expectTypeOf<T['query']>().toEqualTypeOf<typeof query>()
expectTypeOf<T['body']>().toEqualTypeOf<typeof body>()
expectTypeOf<T['headers']>().toEqualTypeOf<typeof headers>()
expectTypeOf<T['response']>().toEqualTypeOf<typeof response>()
expectTypeOf<T['status']>().toEqualTypeOf<201>()
expectTypeOf<T['throws']>().toEqualTypeOf<typeof notFound | typeof forbidden>()
expectTypeOf<InferIn<T['query']>>().toEqualTypeOf<{ page: string }>()
expectTypeOf<InferOut<T['query']>>().toEqualTypeOf<{ page: number }>()
expectTypeOf<InferOut<T['body']>>().toEqualTypeOf<{ name: string }>()
expectTypeOf<InferOut<T['response']>>().toEqualTypeOf<{ id: number; name: string }>()
expectTypeOf<InferOut<T['headers']>>().toEqualTypeOf<{ 'x-tenant': string }>()
expectTypeOf<InferOut<undefined>>().toEqualTypeOf<undefined>()
expectTypeOf(full).toMatchTypeOf<AnyEndpoint>()

// --- builder order does not matter; a later call overrides the slot
const reordered = endpoint.post('/teams/:team/users').throws(notFound).response(response, 201).body(body)
expectTypeOf(reordered.__types.response).toEqualTypeOf<typeof response>()
expectTypeOf(reordered.__types.throws).toEqualTypeOf<typeof notFound>()
expectTypeOf(endpoint.get('/').body(body).body(response).__types.body).toEqualTypeOf<typeof response>()

// --- response status: default 200, literal otherwise
expectTypeOf(endpoint.get('/').response(response).__types.status).toEqualTypeOf<200>()
expectTypeOf(endpoint.get('/').response(response, 201).__types.status).toEqualTypeOf<201>()

// --- several errors in one call keep each literal
const multi = endpoint.get('/').throws(notFound, forbidden)
expectTypeOf<(typeof multi.__types.throws)['code']>().toEqualTypeOf<'POST_NOT_FOUND' | 'NOT_OWNER'>()

// --- capabilities: each call sets one slot of `caps`, a later call overrides it
expectTypeOf(endpoint.get('/').auth().__types.caps).toEqualTypeOf<{ auth: true; authorize: undefined; throttle: undefined }>()
expectTypeOf(endpoint.get('/').public().__types.caps).toEqualTypeOf<{ auth: false; authorize: undefined; throttle: undefined }>()
expectTypeOf(endpoint.get('/').authorize().__types.caps.authorize).toEqualTypeOf<true>()
expectTypeOf(endpoint.get('/').authorize(false).__types.caps.authorize).toEqualTypeOf<false>()
expectTypeOf(endpoint.get('/').throttle({ limit: 5, per: '1m' }).__types.caps.throttle).toEqualTypeOf<true>()
expectTypeOf(endpoint.get('/').throttle(false).__types.caps.throttle).toEqualTypeOf<false>()
expectTypeOf(endpoint.get('/').public().auth().throttle(false).authorize().__types.caps).toEqualTypeOf<{ auth: true; authorize: true; throttle: false }>()
expectTypeOf(endpoint.get('/').throttle({ limit: 5, per: 30 }).public().__types.caps.throttle).toEqualTypeOf<true>()

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
// @ts-expect-error throws takes error factories (defineError)
endpoint.get('/').throws({ status: 404, code: 'X' })
// @ts-expect-error .errors() was removed: errors are derived from capabilities, domain errors use .throws()
endpoint.get('/').errors(notFound)
// @ts-expect-error no guard registered: GuardRegistry is empty unless the app augments it
endpoint.get('/').auth('nope')
// @ts-expect-error throttle needs a limit
endpoint.get('/').throttle({ per: '1m' })
// @ts-expect-error unknown duration unit
endpoint.get('/').throttle({ limit: 1, per: '1w' })
// @ts-expect-error throttle(true) is not an opt-in: pass { limit, per }
endpoint.get('/').throttle(true)
// @ts-expect-error def is readonly
bare.def = full.def
// @ts-expect-error def fields are readonly
bare.def.path = '/x'
// @ts-expect-error unknown path param
bare.__types.params.post
expectTypeOf(bare.__types.params).not.toEqualTypeOf<{ user: string; extra: string }>()

// --- regression: in a contextually typed position (e.g. defineContract), the AnyEndpoint
// return type must not become an inference candidate for the status (would give `any`)
const contextual = <T extends Record<string, AnyEndpoint>>(x: T): T => x
const ctx = contextual({
  index: endpoint.get('/').query(query).response(response),
  created: endpoint.post('/').response(response, 201),
})
expectTypeOf(ctx.index.__types.status).toEqualTypeOf<200>()
expectTypeOf(ctx.created.__types.status).toEqualTypeOf<201>()

// --- success statuses: 204 without a response schema, .status(n) for a body-less 2xx, 2xx only
expectTypeOf<Endpoint<'get', '/'>['__types']['status']>().toEqualTypeOf<204>()
expectTypeOf<Endpoint<'get', '/', undefined, undefined, undefined, typeof response>['__types']['status']>().toEqualTypeOf<200>()
expectTypeOf(endpoint.post('/jobs').status(202).__types.status).toEqualTypeOf<202>()
expectTypeOf(endpoint.post('/jobs').status(202).__types.response).toEqualTypeOf<undefined>()
// @ts-expect-error a success status must be 2xx
endpoint.post('/jobs').status(301)
// @ts-expect-error a success status must be 2xx, with a body too
endpoint.get('/').response(response, 404)
// @ts-expect-error .status() is for a body-less success: use .response(schema, status)
endpoint.get('/').response(response).status(202)

// .response(schema) keeps a status set by .status(n); a 204 has no body
expectTypeOf(endpoint.post('/jobs').status(202).response(response).__types.status).toEqualTypeOf<202>()
expectTypeOf(endpoint.post('/jobs').status(204).response(response).__types.status).toEqualTypeOf<200>()
expectTypeOf(endpoint.post('/jobs').status(202).response(response, 201).__types.status).toEqualTypeOf<201>()
// @ts-expect-error a 204 has no body: use .status(204)
endpoint.get('/').response(response, 204)
