// FE fixture: imports the generated appApi (`$api`) and the client only. Compiled by fe.test.ts with tsconfig.json.
import { createClient } from '@laratype/client'
import { appApi } from '$api'

const api = createClient(appApi, { baseUrl: location.origin, headers: { accept: 'application/json' } })

export async function renamePost(user: number, post: number, title: string): Promise<string> {
  const result = await api.users.posts.update({ params: { user, post }, body: { title } })
  if (result.ok) return result.data.title
  if (result.code === 'VALIDATION_ERROR') return Object.keys(result.error.errors).join(', ')
  if (result.code === 'ACCOUNT_LOCKED' || result.code === 'FORBIDDEN') return result.error.message
  return result.unexpected ? `unexpected ${result.status}` : result.code
}

export async function userSince(id: string): Promise<string | undefined> {
  const result = await api.users.show({ params: { user: id } })
  return result.ok ? result.data.createdAt : undefined
}

export async function healthy(signal: AbortSignal): Promise<boolean> {
  const result = await api.v1.health.check({ signal })
  return result.ok && result.data.ok
}

export const root: HTMLElement | null = document.querySelector('#app')
