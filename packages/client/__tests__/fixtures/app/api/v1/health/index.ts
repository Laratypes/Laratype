// app/api/v1/health/index.ts → /api/v1/health, api.v1.health (v1 is a folder without a contract)
import * as z from 'zod'
import { defineContract, endpoint } from '@laratype/contract'
import type { Prefix } from './$types'

export default defineContract<Prefix>()({
  check: endpoint.get('/').public().throttle(false).response(z.object({ ok: z.boolean() })),
})
