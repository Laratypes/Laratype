// Separate-repo FE fixture: the generated api.ts (AppApi + manifest) and @laratype/client only.
import { createClient } from '@laratype/client'
import { manifest } from './api'
import type { AppApi } from './api'

const api = createClient<AppApi>(manifest, { baseUrl: 'https://api.example.com' })

export async function renamePost(user: string, post: string, title: string): Promise<string> {
  const result = await api.users.posts.update({ params: { user, post }, body: { title } })
  if (result.ok) return result.data.title
  return result.code === 'ACCOUNT_LOCKED' ? result.error.message : `failed ${result.status}`
}

export async function userSince(id: number): Promise<string | undefined> {
  // Date in the response schema, string on the wire
  const result = await api.users.show({ params: { user: id } })
  return result.ok ? result.data.createdAt : undefined
}

export async function healthy(): Promise<boolean> {
  const result = await api.v1.health.check()
  return result.ok && result.data.ok
}

export const root: HTMLElement | null = document.querySelector('#app')
