// docs/v1/contract.md: endpoint builder, path params, capabilities and derived errors, domain errors.
import { expectTypeOf } from 'vitest'
import * as z from 'zod'
import { defineError, endpoint, errors } from '@laratype/contract'
import type { EndpointErrors, ErrorCode, ErrorResponse, InferIn, InferOut, PathParams } from '@laratype/contract'

const UserDto = z.object({ id: z.number(), name: z.string() })

// One endpoint: method + Hono-style path, then optional slots in any order.
export const showPost = endpoint
  .get('/users/:user/posts/:post?')
  .query(z.object({ page: z.coerce.number().default(1) }))
  .response(UserDto)
  .auth()
  .authorize()

type T = typeof showPost.__types
expectTypeOf<T['params']>().toEqualTypeOf<{ user: string; post?: string }>()
expectTypeOf<T['status']>().toEqualTypeOf<200>()
expectTypeOf<InferIn<T['query']>>().toEqualTypeOf<{ page?: number | undefined }>()
expectTypeOf<InferOut<T['query']>>().toEqualTypeOf<{ page: number }>()
expectTypeOf<InferOut<T['response']>>().toEqualTypeOf<{ id: number; name: string }>()
// Errors are derived from the capabilities: query → 422, path param → 404, auth → 401, authorize → 403.
expectTypeOf<ErrorCode<EndpointErrors<typeof showPost>>>().toEqualTypeOf<'VALIDATION_ERROR' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'FORBIDDEN'>()

// Domain errors: an UPPER_SNAKE code, an optional body factory; thrown at any depth, declared with .throws().
export const EmailTaken = defineError(409, 'EMAIL_TAKEN', (email: string) => ({ message: 'The email is taken.', email }))

// A non-default success status is a literal type.
export const storeUser = endpoint
  .post('/users')
  .body(z.object({ name: z.string().min(1), email: z.string() }))
  .response(UserDto, 201)
  .throws(EmailTaken)
  .throttle({ limit: 10, per: '1m' })
expectTypeOf(storeUser.__types.status).toEqualTypeOf<201>()
type StoreError = ErrorResponse<EndpointErrors<typeof storeUser>>
expectTypeOf<StoreError['code']>().toEqualTypeOf<'VALIDATION_ERROR' | 'TOO_MANY_REQUESTS' | 'EMAIL_TAKEN'>()

// Narrow by code: two errors can share a status.
export const describeError = (e: StoreError): string => (e.code === 'EMAIL_TAKEN' ? `taken: ${e.body.email}` : e.body.message)

// `E.is(e)` checks a thrown ContractError (by brand) with this code and status, so it works across bundles; a client
// result is not a ContractError: narrow it by `code` instead.
export const isTaken = (e: unknown): boolean => EmailTaken.is(e) && e.body.email !== ''

// `.public()`, `.authorize(false)` and `.throttle(false)` opt an endpoint out of an inherited capability.
export const health = endpoint.get('/health').public().throttle(false)
// `throws` also accepts the built-in errors: a search with no path param whose service throws notFound.
export const search = endpoint.get('/search').query(z.object({ q: z.string() })).throws(errors.notFound)

// Path params follow Hono's syntax: regex patterns never leak into keys, wildcards add nothing.
expectTypeOf<PathParams<'/posts/:id{[0-9]+}'>>().toEqualTypeOf<{ id: string }>()
expectTypeOf<PathParams<'/files/*'>>().toEqualTypeOf<{}>()

// Without a body factory the body is { message: string }.
export const paymentRequired = defineError(402, 'PAYMENT_REQUIRED')

// The runtime def is plain data for the router, the client and OpenAPI.
export const def = storeUser.def // { method: 'post', path: '/users', status: 201, body, response, throws: [EmailTaken], throttle: {...} }
