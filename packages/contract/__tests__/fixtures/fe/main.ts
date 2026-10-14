// FE fixture: compiled with `types: []` + DOM lib by typecheck.test.ts, which also asserts that no server file is loaded.
import { apiRoutes } from '@laratype/contract'
import type { ApiTypes } from '@laratype/contract'
import { appApi } from '../app/api'
import type { AppApi } from '../app/api'
import { EmailTaken } from '../app/api/errors'

type Api = ApiTypes<AppApi>

export async function showPost(user: string, id: string): Promise<Api['users']['posts']['index']['response']> {
  const route = apiRoutes(appApi).find((r) => r.name === 'users.posts.index')!
  const url = route.path.replace(':user', encodeURIComponent(user))
  const res = await fetch(`${url}?q=${encodeURIComponent(id)}`, { method: route.method.toUpperCase() })
  return res.json()
}

export const routeNames = apiRoutes(appApi).map(({ name }) => name)
export const storeBody: Api['users']['store']['body'] = { name: 'Ada', email: 'ada@example.com' }
export const emailTaken = (e: Api['users']['store']['errors']) => e.code === EmailTaken.code && e.body.email
export const root: HTMLElement | null = document.querySelector('#app')
