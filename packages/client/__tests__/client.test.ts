import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@laratype/client'
import type { FetchLike } from '@laratype/client'
import { appApi } from './fixtures/.laratype/api/index.gen'
import users from './fixtures/app/api/users'
import { manifest } from './fixtures/separate-fe/api'
import type { AppApi } from './fixtures/separate-fe/api'

/** A fake fetch that records each request and answers with `body` as JSON. */
const fakeFetch = (body: unknown = {}, status = 200) => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown; signal: AbortSignal | undefined }> = []
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    calls.push({
      url,
      method: init.method!,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: init.body,
      signal: init.signal ?? undefined,
    })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  })
  return { fetch, calls }
}

describe('createClient', () => {
  it('names calls after the folder tree, including folders without a contract', () => {
    const api = createClient(appApi, { fetch: fakeFetch().fetch })
    expect(Object.keys(api)).toEqual(['users', 'v1'])
    expect(Object.keys(api.users)).toEqual(['index', 'show', 'store', 'posts'])
    expect(Object.keys(api.users.posts)).toEqual(['index', 'update'])
    expect(Object.keys(api.v1)).toEqual(['health'])
    expect(typeof api.v1.health.check).toBe('function')
    expect(Object.isFrozen(api.users.posts)).toBe(true)
  })

  it('builds the URL from the full contract path, with encoded params and the query', async () => {
    const { fetch, calls } = fakeFetch()
    const api = createClient(appApi, { fetch })
    await api.users.posts.update({ params: { user: 'a b/c', post: 7 }, body: { title: 'Hi' } })
    await api.users.posts.index({ params: { user: 1 }, query: { q: 'x&y', tags: ['a', 'b'] } })
    await api.users.index({ query: { page: 2 } })
    await api.v1.health.check()
    expect(calls.map((c) => c.url)).toEqual([
      '/api/users/a%20b%2Fc/posts/7',
      '/api/users/1/posts?q=x%26y&tags=a&tags=b',
      '/api/users?page=2',
      '/api/v1/health',
    ])
  })

  it('prepends baseUrl (the origin) without doubling the slash', async () => {
    const { fetch, calls } = fakeFetch()
    await createClient(appApi, { fetch, baseUrl: 'https://example.com/' }).users.show({ params: { user: 3 } })
    expect(calls[0]!.url).toBe('https://example.com/api/users/3')
  })

  it('sends the method in upper case', async () => {
    const { fetch, calls } = fakeFetch()
    const api = createClient(appApi, { fetch })
    await api.users.index()
    await api.users.store({ body: { name: 'Ada', email: 'ada@example.com' }, headers: { 'x-tenant': 't1' } })
    await api.users.posts.update({ params: { user: 1, post: 2 }, body: { title: 'T' } })
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST', 'PATCH'])
  })

  it('sends a JSON body with content-type, and merges default and call headers', async () => {
    const { fetch, calls } = fakeFetch()
    const api = createClient(appApi, { fetch, headers: { authorization: 'Bearer t', 'x-tenant': 'default' } })
    await api.users.store({ body: { name: 'Ada', email: 'ada@example.com' }, headers: { 'x-tenant': 't1' } })
    await api.users.index()
    expect(calls[0]!.body).toBe('{"name":"Ada","email":"ada@example.com"}')
    expect(calls[0]!.headers).toEqual({ authorization: 'Bearer t', 'content-type': 'application/json', 'x-tenant': 't1' })
    // no body: no body and no content-type
    expect(calls[1]!.body).toBeUndefined()
    expect(calls[1]!.headers).toEqual({ authorization: 'Bearer t', 'x-tenant': 'default' })
  })

  it('keeps a content-type the caller set', async () => {
    const { fetch, calls } = fakeFetch()
    await createClient(appApi, { fetch }).users.store({
      body: { name: 'Ada', email: 'a@b.c' },
      headers: { 'x-tenant': 't', 'content-type': 'application/vnd.api+json' },
    })
    expect(calls[0]!.headers['content-type']).toBe('application/vnd.api+json')
  })

  it('passes the AbortSignal through', async () => {
    const { fetch, calls } = fakeFetch()
    const controller = new AbortController()
    await createClient(appApi, { fetch }).users.index({ signal: controller.signal })
    expect(calls[0]!.signal).toBe(controller.signal)
  })

  it('resolves to the raw Response, non-2xx included', async () => {
    const ok = createClient(appApi, { fetch: fakeFetch([{ id: 1, title: 'T' }]).fetch })
    const res = await ok.users.posts.index({ params: { user: 1 } })
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 1, title: 'T' }])

    const notFound = createClient(appApi, { fetch: fakeFetch({ code: 'NOT_FOUND', message: 'Not found.' }, 404).fetch })
    const res404 = await notFound.users.show({ params: { user: 9 } })
    expect(res404.ok).toBe(false)
    expect(res404.status).toBe(404)
  })

  it('throws on a missing required param before calling fetch', () => {
    const { fetch } = fakeFetch()
    const api = createClient(appApi, { fetch })
    // @ts-expect-error runtime check
    expect(() => api.users.show({ params: {} })).toThrow('[@laratype/contract] buildUrl: missing param "user" for "/api/users/:user"')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the global fetch, read at call time, when none is injected', async () => {
    const { fetch, calls } = fakeFetch()
    const api = createClient(appApi)
    vi.stubGlobal('fetch', fetch)
    try {
      await api.v1.health.check()
    } finally {
      vi.unstubAllGlobals()
    }
    expect(calls[0]!.url).toBe('/api/v1/health')
  })

  it('builds a client from an API node or a single contract', async () => {
    const { fetch, calls } = fakeFetch()
    await createClient(appApi.users.posts, { fetch }).update({ params: { user: 1, post: 2 }, body: { title: 'T' } })
    // a contract alone has no folder prefix: its paths go on baseUrl as they are
    await createClient(users, { fetch, baseUrl: 'https://example.com/api/users' }).show({ params: { user: 5 } })
    expect(calls.map((c) => c.url)).toEqual(['/api/users/1/posts/2', 'https://example.com/api/users/5'])
  })

  it('rejects anything else', () => {
    expect(() => createClient({ nope: 1 })).toThrow(
      new TypeError('[@laratype/client] createClient: expected the appApi from defineApi, an API node, a contract or the generated manifest'),
    )
  })
})

describe('createClient(manifest), the separate-repo FE', () => {
  it('nests the route names and calls each full path with its method', async () => {
    const { fetch, calls } = fakeFetch()
    const api = createClient<AppApi>(manifest, { fetch, baseUrl: 'https://api.example.com' })
    expect(Object.keys(api)).toEqual(['users', 'v1'])
    expect(Object.keys(api.users)).toEqual(['index', 'posts', 'show', 'store'])
    expect(Object.isFrozen(api.users.posts)).toBe(true)

    await api.users.posts.update({ params: { user: 'a/b', post: 2 }, body: { title: 'T' } })
    await api.users.index({ query: { page: 3 } })
    await api.v1.health.check()
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['PATCH', 'https://api.example.com/api/users/a%2Fb/posts/2', '{"title":"T"}'],
      ['GET', 'https://api.example.com/api/users?page=3', undefined],
      ['GET', 'https://api.example.com/api/v1/health', undefined],
    ])
    expect(calls[0]!.headers['content-type']).toBe('application/json')
  })

  it('rejects a manifest with bad route names', () => {
    const route = { method: 'get', path: '/x' }
    expect(() => createClient({ health: route })).toThrow('[@laratype/client] createClient: invalid route name "health" in the manifest')
    expect(() => createClient({ 'a.b': route, 'a.b.c': route })).toThrow('createClient: "a.b.c" is under the endpoint "b" in the manifest')
    expect(() => createClient({ 'a.b.c': route, 'a.b': route })).toThrow('createClient: "a.b" is both an endpoint and a node in the manifest')
  })
})
