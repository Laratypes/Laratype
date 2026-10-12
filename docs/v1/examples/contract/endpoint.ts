// docs/v1/contract.md: endpoint builder, path params, error catalog (merged on master).
import { expectTypeOf } from 'vitest'
import * as z from 'zod'
import { defineError, endpoint, errors } from '@laratype/contract'
import type { ErrorResponse, InferIn, InferOut, PathParams } from '@laratype/contract'

const UserDto = z.object({ id: z.number(), name: z.string() })

// One endpoint: method + Hono-style path, then optional slots in any order.
export const showPost = endpoint
  .get('/users/:user/posts/:post?')
  .query(z.object({ page: z.coerce.number().default(1) }))
  .response(UserDto)
  .errors(errors.notFound, errors.forbidden)

type T = typeof showPost.__types
expectTypeOf<T['params']>().toEqualTypeOf<{ user: string; post?: string }>()
expectTypeOf<T['status']>().toEqualTypeOf<200>()
expectTypeOf<InferIn<T['query']>>().toEqualTypeOf<{ page?: number | undefined }>()
expectTypeOf<InferOut<T['query']>>().toEqualTypeOf<{ page: number }>()
expectTypeOf<InferOut<T['response']>>().toEqualTypeOf<{ id: number; name: string }>()
expectTypeOf<ErrorResponse<T['errors']>['status']>().toEqualTypeOf<404 | 403>()

// A non-default success status is a literal type.
export const storeUser = endpoint
  .post('/users')
  .body(z.object({ name: z.string().min(1) }))
  .response(UserDto, 201)
  .errors(errors.validation)
expectTypeOf(storeUser.__types.status).toEqualTypeOf<201>()

// Path params follow Hono's syntax: regex patterns never leak into keys, wildcards add nothing.
expectTypeOf<PathParams<'/posts/:id{[0-9]+}'>>().toEqualTypeOf<{ id: string }>()
expectTypeOf<PathParams<'/files/*'>>().toEqualTypeOf<{}>()

// App-specific errors: the body defaults to { message: string }.
export const paymentRequired = defineError<402, { message: string; checkoutUrl: string }>(402, 'PAYMENT_REQUIRED')

// The runtime def is plain data for the router, the client and OpenAPI.
export const def = storeUser.def // { method: 'post', path: '/users', status: 201, body, response, errors: [...] }
