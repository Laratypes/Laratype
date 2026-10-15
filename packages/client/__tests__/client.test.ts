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

  it('rejects on a missing required param, before calling fetch', async () => {
    const { fetch } = fakeFetch()
    const api = createClient(appApi, { fetch })
    // @ts-expect-error runtime check
    await expect(api.users.show({ params: {} })).rejects.toThrow('[@laratype/contract] buildUrl: missing param "user" for "/api/users/:user"')
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

/** A fetch answering with a raw body, for the result union. */
const respond = (body: BodyInit | null, status = 200) => vi.fn<FetchLike>(async () => new Response(body, { status }))
const json = (value: unknown, status = 200) => respond(JSON.stringify(value), status)

describe('the result union', () => {
  it('success: ok, the status and the parsed JSON body, with the unread Response', async () => {
    const api = createClient(appApi, { fetch: json([{ id: 1, title: 'T' }]) })
    const result = await api.users.posts.index({ params: { user: 1 } })
    expect(result).toEqual({ ok: true, status: 200, data: [{ id: 1, title: 'T' }], response: expect.any(Response) })
    expect(result.response!.bodyUsed).toBe(false)
    expect(await result.response!.json()).toEqual([{ id: 1, title: 'T' }])
  })

  it('204 or an empty body: ok, data undefined', async () => {
    const res204 = await createClient(appApi, { fetch: respond(null, 204) }).users.posts.index({ params: { user: 1 } })
    expect(res204).toMatchObject({ ok: true, status: 204, data: undefined })
    const empty = await createClient(appApi, { fetch: respond('', 200) }).v1.health.check()
    expect(empty).toMatchObject({ ok: true, status: 200, data: undefined })
  })

  it('a declared error: the wire { code, ...body } splits into code and error', async () => {
    const api = createClient(appApi, { fetch: json({ code: 'EMAIL_TAKEN', message: 'The email is taken.', email: 'a@b.c' }, 409) })
    const result = await api.users.store({ body: { name: 'Ada', email: 'a@b.c' } })
    expect(result).toEqual({
      ok: false,
      status: 409,
      code: 'EMAIL_TAKEN',
      error: { message: 'The email is taken.', email: 'a@b.c' },
      response: expect.any(Response),
    })
  })

  it('two declared errors with the same status (403), told apart by code', async () => {
    const update = (body: unknown) =>
      createClient(appApi, { fetch: json(body, 403) }).users.posts.update({ params: { user: 1, post: 2 }, body: { title: 'T' } })
    const forbidden = await update({ code: 'FORBIDDEN', message: 'No.' })
    const locked = await update({ code: 'ACCOUNT_LOCKED', message: 'Locked.' })
    expect(forbidden).toMatchObject({ ok: false, status: 403, code: 'FORBIDDEN', error: { message: 'No.' } })
    expect(locked).toMatchObject({ ok: false, status: 403, code: 'ACCOUNT_LOCKED', error: { message: 'Locked.' } })
    expect(forbidden).not.toHaveProperty('unexpected')
  })

  it('derived errors come from every level: the scope throttle (429) and the folder param (404)', async () => {
    const index = (body: unknown, status: number) =>
      createClient(appApi, { fetch: json(body, status) }).users.posts.index({ params: { user: 1 } })
    expect(await index({ code: 'TOO_MANY_REQUESTS', message: 'Slow down.' }, 429)).toMatchObject({ ok: false, code: 'TOO_MANY_REQUESTS' })
    expect(await index({ code: 'NOT_FOUND', message: 'Not Found.' }, 404)).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })

  it('an undeclared code or status is unexpected, with the parsed body', async () => {
    // v1.health.check is public, unthrottled and has no params: it declares no error
    const undeclared = await createClient(appApi, { fetch: json({ code: 'NOT_FOUND', message: 'x' }, 404) }).v1.health.check()
    expect(undeclared).toEqual({
      ok: false,
      unexpected: true,
      status: 404,
      error: { code: 'NOT_FOUND', message: 'x' },
      response: expect.any(Response),
    })
    // a declared code with the wrong status
    const wrongStatus = await createClient(appApi, { fetch: json({ code: 'EMAIL_TAKEN', message: 'x' }, 400) }).users.store({
      body: { name: 'Ada', email: 'a@b.c' },
    })
    expect(wrongStatus).toMatchObject({ ok: false, unexpected: true, status: 400 })
    // a JSON body without a code
    const noCode = await createClient(appApi, { fetch: json(['x'], 409) }).users.store({ body: { name: 'Ada', email: 'a@b.c' } })
    expect(noCode).toMatchObject({ ok: false, unexpected: true, status: 409, error: ['x'] })
  })

  it('the server 500 { message: "Server Error" } has no code, so it is unexpected', async () => {
    const result = await createClient(appApi, { fetch: json({ message: 'Server Error' }, 500) }).users.index()
    expect(result).toEqual({ ok: false, unexpected: true, status: 500, error: { message: 'Server Error' }, response: expect.any(Response) })
  })

  it('a non-JSON body is unexpected, on a 2xx or an error status', async () => {
    const ok = await createClient(appApi, { fetch: respond('<html>ok</html>', 200) }).v1.health.check()
    expect(ok).toMatchObject({ ok: false, unexpected: true, status: 200, error: expect.any(SyntaxError) })
    expect(await ok.response!.text()).toBe('<html>ok</html>')
    const badGateway = await createClient(appApi, { fetch: respond('Bad Gateway', 502) }).users.index()
    expect(badGateway).toMatchObject({ ok: false, unexpected: true, status: 502, error: expect.any(SyntaxError) })
  })

  it('a network failure or an abort resolves as unexpected, with status 0 and no response', async () => {
    const offline = new TypeError('Failed to fetch')
    const api = createClient(appApi, { fetch: vi.fn<FetchLike>(() => Promise.reject(offline)) })
    expect(await api.users.index()).toEqual({ ok: false, unexpected: true, status: 0, error: offline, response: undefined })

    const controller = new AbortController()
    controller.abort()
    const aborting = createClient(appApi, { fetch: (_, init) => Promise.reject(init.signal!.reason) })
    const aborted = await aborting.users.index({ signal: controller.signal })
    expect(aborted).toMatchObject({ ok: false, unexpected: true, status: 0, error: controller.signal.reason })
  })

  it('a contract alone resolves its errors from its own options', async () => {
    const result = await createClient(users, { fetch: json({ code: 'UNAUTHORIZED', message: 'Unauthenticated.' }, 401) }).index()
    expect(result).toMatchObject({ ok: false, status: 401, code: 'UNAUTHORIZED' })
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

  it('classifies errors with the manifest codes (codes only, any status)', async () => {
    const api = (body: unknown, status: number) => createClient<AppApi>(manifest, { fetch: json(body, status) })
    const store = { body: { name: 'A', email: 'a' } }
    expect(await api({ code: 'EMAIL_TAKEN', message: 'x', email: 'a' }, 409).users.store(store)).toMatchObject({
      ok: false,
      code: 'EMAIL_TAKEN',
      error: { message: 'x', email: 'a' },
    })
    // ACCOUNT_LOCKED is declared under users/[user], not on users.store
    expect(await api({ code: 'ACCOUNT_LOCKED', message: 'x' }, 403).users.store(store)).toMatchObject({ ok: false, unexpected: true })
    expect(await api({ ok: true }, 200).v1.health.check()).toMatchObject({ ok: true, data: { ok: true } })
  })

  it('rejects a manifest with bad route names', () => {
    const route = { method: 'get', path: '/x' }
    expect(() => createClient({ health: route })).toThrow('[@laratype/client] createClient: invalid route name "health" in the manifest')
    expect(() => createClient({ 'a.b': route, 'a.b.c': route })).toThrow('createClient: "a.b.c" is under the endpoint "b" in the manifest')
    expect(() => createClient({ 'a.b.c': route, 'a.b': route })).toThrow('createClient: "a.b" is both an endpoint and a node in the manifest')
  })
})
