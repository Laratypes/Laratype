// Separate-repo FE: compiled by generate.test.ts with `types: []` + the DOM lib, against the generated api.ts only.
import { manifest } from '../generated/api'
import type { AppApi } from '../generated/api'

type User = AppApi['users']['show']['response']
type Update = AppApi['users']['posts']['update']

export const label = (user: User): string => `${user.name.toUpperCase()} (${user.role}) ${user.address.zip ?? ''}`
export const created = (user: User): number => user.createdAt.getTime() + user.pair[0]
export const tags = (user: User): string[] => user.tags.filter((t) => user.meta[t])

export async function updatePost(params: Update['params'], body: Update['body']): Promise<Update['response']> {
  const route = manifest['users.posts.update']
  const path = route.path.replace(':user', params.user).replace(':post', params.post)
  const res = await fetch(path, { method: route.method.toUpperCase(), body: JSON.stringify(body) })
  return res.json()
}

// Narrow by code: two errors can share a status.
export function describeError(error: AppApi['users']['store']['errors']): string {
  if (error.code === 'EMAIL_TAKEN') return error.body.email
  if (error.code === 'VALIDATION_ERROR') return Object.keys(error.body.errors).join(', ')
  return error.body.message
}

export const healthIsPublic: boolean = !(manifest['v1.health.check'].errors as readonly string[]).includes('UNAUTHORIZED')
export const root: HTMLElement | null = document.querySelector('#app')
