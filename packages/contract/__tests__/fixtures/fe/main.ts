// FE fixture: compiled with `types: []` + DOM lib by typecheck.test.ts, which also asserts that no server file is loaded.
import { apiEndpoint, apiRoutes } from '@laratype/contract'
import type { ApiTypes } from '@laratype/contract'
import { appApi } from '../app/contracts'
import type { AppApi } from '../app/contracts'

type Api = ApiTypes<AppApi>

export async function showUser(id: string): Promise<Api['users']['show']['response']> {
  const { method, path } = apiEndpoint(appApi, 'users.show').def
  const url = path.replace(':user', encodeURIComponent(id))
  const res = await fetch(url, { method: method.toUpperCase() })
  return res.json()
}

export const routeNames = apiRoutes(appApi).map(([name]) => name)
export const storeBody: Api['users']['store']['body'] = { name: 'Ada', email: 'ada@example.com' }
export const root: HTMLElement | null = document.querySelector('#app')
