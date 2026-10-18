// FE fixture: imports the generated appApi (`$api`) and the client only. Compiled by fe.test.ts with tsconfig.json.
import { createClient } from '@laratype/client'
import { appApi } from '$api'

const api = createClient(appApi, { baseUrl: location.origin, headers: { accept: 'application/json' } })

export async function renamePost(user: number, post: number, title: string): Promise<string> {
  const res = await api.users.posts.update({ params: { user, post }, body: { title } })
  const updated = await res.json()
  return updated.title
}

export async function userSince(id: string): Promise<string> {
  const user = await (await api.users.show({ params: { user: id } })).json()
  return user.createdAt
}

export async function healthy(signal: AbortSignal): Promise<boolean> {
  const res = await api.v1.health.check({ signal })
  return res.ok && (await res.json()).ok
}

export const root: HTMLElement | null = document.querySelector('#app')
