// Separate-repo FE fixture: the generated api.ts (AppApi + manifest) and @laratype/client only.
import { createClient } from '@laratype/client'
import { manifest } from './api'
import type { AppApi } from './api'

const api = createClient<AppApi>(manifest, { baseUrl: 'https://api.example.com' })

export async function renamePost(user: string, post: string, title: string): Promise<string> {
  const res = await api.users.posts.update({ params: { user, post }, body: { title } })
  return (await res.json()).title
}

export async function userSince(id: number): Promise<string> {
  // Date in the response schema, string on the wire
  return (await (await api.users.show({ params: { user: id } })).json()).createdAt
}

export async function healthy(): Promise<boolean> {
  return (await (await api.v1.health.check()).json()).ok
}

export const root: HTMLElement | null = document.querySelector('#app')
