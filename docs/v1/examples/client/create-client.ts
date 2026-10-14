// docs/v1/client.md: createClient (CL1 #109). In an app, `appApi` comes from `$api` (.laratype/api/index.gen.ts).
import { expectTypeOf } from 'vitest'
import { createClient } from '@laratype/client'
import { buildUrl } from '@laratype/contract'
import { appApi } from '../contract/contracts'

// Contract paths are full ("/api/users/:user/posts"): baseUrl is only the origin, "" (same origin) by default.
const api = createClient(appApi, { baseUrl: 'https://example.com', headers: { authorization: 'Bearer token' } })

export async function rename(user: number, post: number) {
  // PATCH https://example.com/api/users/1/posts/2, JSON body, content-type: application/json
  const res = await api.users.posts.update({ params: { user, post }, body: { title: 'Hello' } })
  if (!res.ok) return undefined // the result union is CL2 #110; for now the call resolves to the Response
  return res.json()
}

export async function firstPage() {
  // GET https://example.com/api/users?page=1
  const users = await (await api.users.index({ query: { page: 1 } })).json()
  expectTypeOf(users).toEqualTypeOf<{ id: number; name: string; email: string }[]>()
  return users
}

// The same pure URL builder, from @laratype/contract
expectTypeOf(buildUrl('/api/users/:user', { params: { user: 1 } })).toEqualTypeOf<string>()
// @ts-expect-error a missing required param
buildUrl('/api/users/:user', { params: {} })
