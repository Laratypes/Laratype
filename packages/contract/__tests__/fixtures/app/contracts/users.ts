import * as z from 'zod'
import { defineContract, endpoint, errors } from '@laratype/contract'

export const UserDto = z.object({ id: z.number(), name: z.string(), email: z.string().email(), createdAt: z.string().transform((s) => new Date(s)) })

export const users = defineContract('users', {
  // `.response()` last in the chain: status must stay 200 (NoInfer regression, see contract.types.ts)
  index: endpoint.get('/users').query(z.object({ page: z.coerce.number().default(1) })).response(z.array(UserDto)),
  show: endpoint.get('/users/:user').response(UserDto).errors(errors.notFound),
  store: endpoint
    .post('/users')
    .body(z.object({ name: z.string().min(1), email: z.string().email() }))
    .headers(z.object({ 'x-tenant': z.string() }))
    .response(UserDto, 201)
    .errors(errors.validation),
  destroy: endpoint.delete('/users/:user').errors(errors.forbidden, errors.notFound),
})
