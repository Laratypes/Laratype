// Client fixture, copied from the G1 project (packages/sauf/__tests__/typegen/fixtures/project), plus a headers schema.
// app/api/users.ts → /api/users, api.users
import * as z from 'zod'
import { defineContract, endpoint } from '@laratype/contract'
import { EmailTaken } from './_errors'
import type { Prefix } from './$types'

interface Address {
  street: string
  zip?: string
}
const Address: z.ZodType<Address> = z.object({ street: z.string(), zip: z.string().optional() })

export const UserDto = z.object({
  id: z.number(),
  name: z.string(),
  role: z.enum(['admin', 'member']),
  address: Address,
  tags: z.array(z.string()),
  pair: z.tuple([z.number(), z.string()]),
  meta: z.record(z.string(), z.boolean()),
  createdAt: z.date(),
})

export default defineContract<Prefix>()({
  index: endpoint.get('/').query(z.object({ page: z.coerce.number().optional() })).response(z.array(UserDto)),
  show: endpoint.get('/:user').response(UserDto),
  store: endpoint
    .post('/')
    .body(z.object({ name: z.string(), email: z.string() }))
    .headers(z.object({ 'x-tenant': z.string() }))
    .response(UserDto, 201)
    .throws(EmailTaken),
}, { auth: true })
