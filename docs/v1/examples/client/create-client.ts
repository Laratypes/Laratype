// docs/v1/client.md: createClient (CL1 #109) and the result union (CL2 #110).
// In an app, `appApi` comes from `$api` (.laratype/api/index.gen.ts).
import { expectTypeOf } from 'vitest'
import { createClient } from '@laratype/client'
import { buildUrl } from '@laratype/contract'
import { appApi } from '../contract/contracts'

// Contract paths are full ("/api/users/:user/posts"): baseUrl is only the origin, "" (same origin) by default.
const api = createClient(appApi, { baseUrl: 'https://example.com', headers: { authorization: 'Bearer token' } })

export async function rename(user: number, post: number) {
  // PATCH https://example.com/api/users/1/posts/2, JSON body, content-type: application/json
  // posts.update has no response schema: it answers 204, and data is undefined
  const result = await api.users.posts.update({ params: { user, post }, body: { title: 'Hello' } })
  return result.ok
}

export async function register(name: string, email: string) {
  const result = await api.users.store({ body: { name, email } })
  if (result.ok) return result.data // 201, Jsonify<UserDto>
  // Narrow by code: the wire body is { code, ...body }, and two errors can share a status
  switch (result.code) {
    case 'EMAIL_TAKEN':
      return `taken: ${result.error.email}` // 409, the body of EmailTaken
    case 'VALIDATION_ERROR':
      return result.error.errors // 422, { message, errors }
    case 'UNAUTHORIZED':
      return 'sign in' // 401, from `auth: true` on the contract
    default:
      // network failure (status 0), undeclared status or code, non-JSON body
      expectTypeOf(result.unexpected).toEqualTypeOf<true>()
      return undefined
  }
}

export async function firstPage() {
  // GET https://example.com/api/users?page=1
  const result = await api.users.index({ query: { page: 1 } })
  if (!result.ok) return []
  expectTypeOf(result.data).toEqualTypeOf<{ id: number; name: string; email: string }[]>()
  return result.data
}

// The same pure URL builder, from @laratype/contract
expectTypeOf(buildUrl('/api/users/:user', { params: { user: 1 } })).toEqualTypeOf<string>()
// @ts-expect-error a missing required param
buildUrl('/api/users/:user', { params: {} })
