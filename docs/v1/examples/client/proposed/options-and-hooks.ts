// docs/v1/client.md: options and hooks (CL3 #124). Proposed: when the PR merges, it moves up to examples/client/ and
// imports '../contract/contracts'.
import { createClient } from '@laratype/client'
import { appApi } from '../../contract/contracts'

declare function readToken(): Promise<string>

const api = createClient(appApi, {
  baseUrl: 'https://api.example.com',
  // sends the session cookie cross-origin
  credentials: 'include',
  // called at each call: always the current token
  headers: async () => ({ authorization: `Bearer ${await readToken()}` }),
  onRequest: ({ init }) => {
    init.headers.set('x-request-id', crypto.randomUUID())
  },
  onResponse: (response, { url }) => {
    if (response.status >= 500) console.warn(`${url} answered ${response.status}`)
  },
})

export async function firstPage(signal: AbortSignal) {
  // the AbortSignal is per call
  const result = await api.users.index({ query: { page: 1 }, signal })
  return result.ok ? result.data : []
}
