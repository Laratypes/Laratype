// app/api/users.ts → /api/users, api.users
import * as z from 'zod'
import { defineContract, endpoint } from '@laratype/contract'
import { EmailTaken } from './errors'

export const UserDto = z.object({ id: z.number(), name: z.string(), email: z.string().email(), createdAt: z.string().transform((s) => new Date(s)) })

export default defineContract()({
  // `.response()` last in the chain: status must stay 200 (NoInfer regression, see contract.types.ts)
  index: endpoint.get('/').query(z.object({ page: z.coerce.number().default(1) })).response(z.array(UserDto)),
  show: endpoint.get('/:user').response(UserDto),
  store: endpoint
    .post('/')
    .body(z.object({ name: z.string().min(1), email: z.string().email() }))
    .headers(z.object({ 'x-tenant': z.string() }))
    .response(UserDto, 201)
    .throws(EmailTaken),
  destroy: endpoint.delete('/:user').authorize(),
  stats: endpoint.get('/stats').public().throttle(false),
}, { auth: true, throttle: { limit: 60, per: '1m' } })
