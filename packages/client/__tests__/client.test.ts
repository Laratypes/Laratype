import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@laratype/client'
import type { ClientOptions, FetchLike } from '@laratype/client'
import { defineApi, defineContract, defineError, endpoint } from '@laratype/contract'
import * as z from 'zod'
import { appApi } from './fixtures/.laratype/api/index.gen'
import users from './fixtures/app/api/users'
import type { Prefix } from './fixtures/app/api/users/[user]/$types'
import { manifest } from './fixtures/separate-fe/api'
import type { AppApi } from './fixtures/separate-fe/api'

/** A fake fetch that records each request and answers with `body` as JSON. */
const fakeFetch = (body: unknown = {}, status = 200) => {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown; signal: AbortSignal | undefined }> = []
  const fetch = vi.fn<FetchLike>(async (input: string | Request, init?: RequestInit) => {
    const request = typeof input === 'string' ? undefined : input
    calls.push({
      url: request ? request.url : (input as string),
      method: request ? request.method : init!.method!,
      headers: Object.fromEntries(new Headers(request ? request.headers : init!.headers).entries()),
      body: request ? (request.body ? await request.text() : undefined) : init!.body,
      signal: request ? request.signal : (init!.signal ?? undefined),
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

  it('content-type precedence: the call headers, then options.headers, then the application/json default', async () => {
    const { fetch, calls } = fakeFetch()
    const body = { name: 'Ada', email: 'a@b.c' }
    const vendor = createClient(appApi, { fetch, headers: { 'content-type': 'application/vnd.api+json' } })
    await vendor.users.store({ body, headers: { 'x-tenant': 't' } })
    await vendor.users.store({ body, headers: { 'x-tenant': 't', 'content-type': 'application/merge-patch+json' } })
    await createClient(appApi, { fetch }).users.store({ body, headers: { 'x-tenant': 't' } })
    expect(calls.map((c) => c.headers['content-type'])).toEqual([
      'application/vnd.api+json',
      'application/merge-patch+json',
      'application/json',
    ])
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

  it('rejects, and does not throw, on a missing required param, before calling fetch', async () => {
    const { fetch } = fakeFetch()
    const api = createClient(appApi, { fetch })
    let pending: Promise<unknown> | undefined
    // @ts-expect-error runtime check
    expect(() => (pending = api.users.show({ params: {} }))).not.toThrow()
    await expect(pending).rejects.toThrow('[@laratype/contract] buildUrl: missing param "user" for "/api/users/:user"')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a dot-segment param value before calling fetch', async () => {
    const { fetch } = fakeFetch()
    const api = createClient(appApi, { fetch })
    await expect(api.users.show({ params: { user: '..' } })).rejects.toThrow(
      '[@laratype/contract] buildUrl: param "user" for "/api/users/:user" cannot be ".." (a dot segment)',
    )
    await expect(api.users.posts.index({ params: { user: '.' } })).rejects.toThrow(/a dot segment/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects on every other request failure too: a body JSON cannot hold, no fetch', async () => {
    const { fetch } = fakeFetch()
    // @ts-expect-error runtime check: a bigint body
    await expect(createClient(appApi, { fetch }).users.posts.update({ params: { user: 1, post: 2 }, body: { title: 1n } })).rejects.toThrow(TypeError)
    vi.stubGlobal('fetch', undefined)
    try {
      await expect(createClient(appApi).users.index()).rejects.toThrow('[@laratype/client] no fetch available: pass options.fetch')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads baseUrl, headers and fetch from the options at each call (a refreshed token applies)', async () => {
    const first = fakeFetch()
    const second = fakeFetch()
    const options: ClientOptions = { fetch: first.fetch, baseUrl: 'https://a.example', headers: { authorization: 'Bearer old' } }
    const api = createClient(appApi, options)
    await api.users.index()
    options.baseUrl = 'https://b.example'
    options.headers = { authorization: 'Bearer new' }
    options.fetch = second.fetch
    await api.users.index()
    expect(first.calls.map((c) => [c.url, c.headers.authorization])).toEqual([['https://a.example/api/users', 'Bearer old']])
    expect(second.calls.map((c) => [c.url, c.headers.authorization])).toEqual([['https://b.example/api/users', 'Bearer new']])
  })

  it('uses the global fetch, read at call time, with (url, init): a polyfill that only takes string URLs works', async () => {
    const seen: Array<[unknown, RequestInit | undefined]> = []
    // node-fetch / cross-fetch style: anything but a string URL is "[object Request]"
    const polyfill = vi.fn(async (input: unknown, init?: RequestInit) => {
      if (typeof input !== 'string') throw new TypeError(`Invalid URL: ${String(input)}`)
      seen.push([input, init])
      return new Response('{}', { status: 201 })
    })
    const api = createClient(appApi, { baseUrl: 'https://example.com' })
    vi.stubGlobal('fetch', polyfill)
    try {
      const controller = new AbortController()
      const result = await api.users.store({ body: { name: 'A', email: 'a' }, headers: { 'x-tenant': 't' }, signal: controller.signal })
      expect(result.ok).toBe(true)
      expect(seen[0]![0]).toBe('https://example.com/api/users')
      expect(seen[0]![1]).toMatchObject({ method: 'POST', body: '{"name":"A","email":"a"}', signal: controller.signal })
      expect(new Headers(seen[0]![1]!.headers).get('x-tenant')).toBe('t')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a synchronous throw from fetch rejects the call; only a rejected promise is the status-0 result', async () => {
    const thrown = new TypeError('bad fetch config')
    const throwing = createClient(appApi, { fetch: () => { throw thrown } })
    await expect(throwing.users.index()).rejects.toBe(thrown)
    const rejecting = createClient(appApi, { fetch: () => Promise.reject(thrown) })
    expect(await rejecting.users.index()).toEqual({ ok: false, unexpected: true, status: 0, error: thrown, response: undefined })
  })

  it('global fetch: a GET with a body or a relative URL in Node rejects without calling fetch', async () => {
    const { fetch } = fakeFetch()
    vi.stubGlobal('fetch', fetch)
    try {
      // @ts-expect-error runtime check
      await expect(createClient(appApi, { baseUrl: 'https://example.com' }).users.index({ body: { x: 1 } })).rejects.toThrow(/a GET request cannot have a body/)
      await expect(createClient(appApi).users.index()).rejects.toThrow(
        '[@laratype/client] relative URL "/api/users" with the global fetch outside a browser: set options.baseUrl to an absolute URL, or pass options.fetch',
      )
    } finally {
      vi.unstubAllGlobals()
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('an injected fetch gets (url, init) as built, unguarded: a relative URL works', async () => {
    const { fetch, calls } = fakeFetch()
    await createClient(appApi, { fetch }).users.index()
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/users'])
    expect(calls).toHaveLength(1)
  })

  it('parses an absolute baseUrl: an invalid URL, credentials or a scheme other than http(s) is refused', async () => {
    const cases: Array<[string, string]> = [
      ['https://example.com:99999/api', 'is not a valid URL'],
      ['https://user:pass@example.com', 'must not contain credentials'],
      ['https://user@example.com/api', 'must not contain credentials'],
      ['ftp://example.com/api', 'must use http or https'],
      ['file:///api', 'must use http or https'],
    ]
    for (const [baseUrl, reason] of cases) {
      expect(() => createClient(appApi, { baseUrl })).toThrow(new TypeError(`[@laratype/client] createClient: baseUrl "${baseUrl}" ${reason}`))
    }
    // a live change is checked at the next call
    const options: ClientOptions = { fetch: fakeFetch().fetch, baseUrl: 'https://example.com' }
    const api = createClient(appApi, options)
    options.baseUrl = 'https://user:pass@example.com'
    await expect(api.users.index()).rejects.toThrow(/must not contain credentials/)
  })

  it('global fetch without Request or URL in the globals: fetch(url, init), unchecked', async () => {
    const { fetch, calls } = fakeFetch()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('Request', undefined)
    try {
      await createClient(appApi, { baseUrl: 'https://example.com' }).users.index()
    } finally {
      vi.unstubAllGlobals()
    }
    expect(typeof fetch.mock.calls[0]![0]).toBe('string')
    expect(calls[0]!.url).toBe('https://example.com/api/users')
  })

  it('reads location only for a relative URL with the global fetch; a location that throws (Deno) counts as none', async () => {
    const { fetch, calls } = fakeFetch()
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location')
    let reads = 0
    let href: string | undefined = 'https://page.example/app'
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      get: () => {
        reads++
        if (href === undefined) throw new ReferenceError('no --location')
        return { href }
      },
    })
    vi.stubGlobal('fetch', fetch)
    try {
      await createClient(appApi, { baseUrl: 'https://example.com' }).users.index()
      expect(reads).toBe(0)
      // in a browser a relative URL resolves against the page
      await createClient(appApi).users.index()
      expect(reads).toBe(1)
      // in a browser fetch resolves the relative URL itself
      expect(calls.map((c) => c.url)).toEqual(['https://example.com/api/users', '/api/users'])
      href = undefined
      await expect(createClient(appApi).users.index()).rejects.toThrow(/relative URL "\/api\/users" with the global fetch outside a browser/)
    } finally {
      vi.unstubAllGlobals()
      if (descriptor) Object.defineProperty(globalThis, 'location', descriptor)
      else delete (globalThis as { location?: unknown }).location
    }
  })

  it('a page base that cannot resolve a path to http(s) (about:, blob:, data:) counts as none: the relative URL rejects', async () => {
    const { fetch } = fakeFetch()
    vi.stubGlobal('fetch', fetch)
    try {
      for (const baseURI of ['about:blank', 'about:srcdoc', 'blob:https://example.com/0f8c', 'data:text/html,<p>x</p>']) {
        vi.stubGlobal('document', { baseURI })
        vi.stubGlobal('location', { href: baseURI })
        await expect(createClient(appApi).users.index()).rejects.toThrow(/relative URL "\/api\/users" with the global fetch outside a browser/)
      }
    } finally {
      vi.unstubAllGlobals()
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a page with a document counts as a browser: the relative URL goes to the global fetch, which resolves it', async () => {
    const { fetch, calls } = fakeFetch()
    vi.stubGlobal('fetch', fetch)
    try {
      vi.stubGlobal('document', { baseURI: 'https://cdn.example/base/' })
      await createClient(appApi).users.index()
      expect(calls[0]!.url).toBe('/api/users')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a GET with a null body too, which would be sent as "null"', async () => {
    const { fetch } = fakeFetch()
    // @ts-expect-error runtime check
    await expect(createClient(appApi, { fetch }).users.index({ body: null })).rejects.toThrow(/a GET request cannot have a body/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a GET with a body before calling fetch, global or injected', async () => {
    const { fetch } = fakeFetch()
    // @ts-expect-error runtime check
    await expect(createClient(appApi, { fetch }).users.index({ body: { x: 1 } })).rejects.toThrow(
      new TypeError('[@laratype/client] a GET request cannot have a body: "/api/users"'),
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a baseUrl with whitespace or control characters, which URL parsing strips ("/\\t/evil.com" is another host)', () => {
    for (const baseUrl of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', 'https://example.com/a b', '/a\u0000', '/a\u007f']) {
      expect(() => createClient(appApi, { baseUrl })).toThrow(
        new TypeError(`[@laratype/client] createClient: baseUrl ${JSON.stringify(baseUrl)} must not contain whitespace or control characters`),
      )
    }
  })

  it('rejects a baseUrl with a backslash, which http(s) URL parsing turns into another host', () => {
    for (const baseUrl of ['/\\evil.com', 'https://example.com/a\\b']) {
      expect(() => createClient(appApi, { baseUrl })).toThrow(
        new TypeError(`[@laratype/client] createClient: baseUrl "${baseUrl}" must not contain a backslash`),
      )
    }
  })

  it('an absolute baseUrl on the sentinel host is still absolute, not mistaken for a path', async () => {
    const { fetch, calls } = fakeFetch()
    await createClient(appApi, { fetch, baseUrl: 'http://__laratype_base__/edge' }).users.index()
    expect(calls[0]!.url).toBe('http://__laratype_base__/edge/api/users')
  })

  it('parses a baseUrl once: the path is normalized and the origin is the parsed one', async () => {
    const { fetch, calls } = fakeFetch()
    await createClient(appApi, { fetch, baseUrl: 'HTTPS://Example.COM:443/edge/./v1/../api-gw/' }).users.index()
    await createClient(users, { fetch, baseUrl: '/edge/./api/users/' }).index()
    expect(calls.map((c) => c.url)).toEqual(['https://example.com/edge/api-gw/api/users', '/edge/api/users'])
    // an empty query or hash is still a query or hash
    for (const baseUrl of ['https://example.com/api?', 'https://example.com/api#', '/api?']) {
      expect(() => createClient(appApi, { baseUrl })).toThrow(/must not have a query or a hash/)
    }
  })

  it('rejects a baseUrl that is neither an absolute URL with "://" nor a path starting with "/"', () => {
    for (const baseUrl of ['localhost:3000/api', 'api', 'example.com', '//cdn.example/api', '//__laratype_base__/api']) {
      expect(() => createClient(appApi, { baseUrl })).toThrow(
        new TypeError(`[@laratype/client] createClient: baseUrl "${baseUrl}" must be an absolute URL (https://…) or a path starting with /`),
      )
    }
    expect(() => createClient(appApi, { baseUrl: '' })).not.toThrow()
    expect(() => createClient(appApi, { baseUrl: '/api' })).not.toThrow()
    expect(() => createClient(appApi, { baseUrl: 'http://localhost:3000' })).not.toThrow()
  })

  it('builds a client from an API node or a single contract, with the same names as the appApi client', async () => {
    expect(Object.keys(createClient(appApi.users))).toEqual(['index', 'show', 'store', 'posts'])
    expect(Object.keys(createClient(appApi.users.posts))).toEqual(['index', 'update'])
    expect(Object.keys(createClient(appApi.v1))).toEqual(['health'])
    expect(Object.keys(createClient(users))).toEqual(['index', 'show', 'store'])
    const { fetch, calls } = fakeFetch()
    await createClient(appApi.users.posts, { fetch }).update({ params: { user: 1, post: 2 }, body: { title: 'T' } })
    // a contract alone has no folder prefix: its paths go on baseUrl as they are
    await createClient(users, { fetch, baseUrl: 'https://example.com/api/users' }).show({ params: { user: 5 } })
    expect(calls.map((c) => c.url)).toEqual(['/api/users/1/posts/2', 'https://example.com/api/users/5'])
  })

  it('accepts endpoints from another package copy (Symbol.for brand, not instanceof)', async () => {
    const foreign = { def: endpoint.get('/:id').def }
    Object.defineProperty(foreign, Symbol.for('laratype.endpoint'), { value: true })
    const api = defineApi({ things: { contract: defineContract()({ show: foreign as never }), path: '/api/things', scopes: [] } })
    const { fetch, calls } = fakeFetch()
    await (createClient(api, { fetch }) as { things: { show: (i: object) => Promise<Response> } }).things.show({ params: { id: 3 } })
    expect(calls.map((c) => [c.method, c.url])).toEqual([['GET', '/api/things/3']])
  })

  it('builds a contract whose .authorize() gets auth from a folder scope (no capability resolution)', async () => {
    // valid in its folder: users/[user]/_scope.ts brings auth. Alone, the contract has no scope to resolve against.
    const scoped = defineContract<Prefix>()({ destroy: endpoint.delete('/:post').authorize() })
    const { fetch, calls } = fakeFetch()
    await createClient(scoped, { fetch, baseUrl: 'https://example.com/api/users/1/posts' }).destroy({ params: { post: 2 } })
    expect(calls.map((c) => [c.method, c.url])).toEqual([['DELETE', 'https://example.com/api/users/1/posts/2']])
  })

  it('joins baseUrl and a single contract\'s "/" route like the server: no trailing slash', async () => {
    const { fetch, calls } = fakeFetch()
    for (const baseUrl of ['https://example.com/api/users', 'https://example.com/api/users/']) {
      const api = createClient(users, { fetch, baseUrl })
      await api.index()
      await api.index({ query: { page: 2 } })
      await api.show({ params: { user: 5 } })
    }
    expect(calls.map((c) => c.url)).toEqual([
      'https://example.com/api/users',
      'https://example.com/api/users?page=2',
      'https://example.com/api/users/5',
      'https://example.com/api/users',
      'https://example.com/api/users?page=2',
      'https://example.com/api/users/5',
    ])
    // with no baseUrl a "/" route stays "/"
    await createClient(users, { fetch }).index()
    expect(calls.at(-1)!.url).toBe('/')
    // a relative baseUrl is all path
    await createClient(users, { fetch, baseUrl: '/api/users/' }).index({ query: { page: 3 } })
    expect(calls.at(-1)!.url).toBe('/api/users?page=3')
  })

  it('never parses baseUrl as route syntax: buildUrl only sees the route path', async () => {
    const { fetch, calls } = fakeFetch()
    const api = createClient(users, { fetch, baseUrl: 'https://example.com/:tenant/api/users' })
    await api.index()
    await api.show({ params: { user: 5 } })
    expect(calls.map((c) => c.url)).toEqual(['https://example.com/:tenant/api/users', 'https://example.com/:tenant/api/users/5'])
  })

  it('rejects a baseUrl with a query or a hash at createClient, and at the call if it is changed later', async () => {
    for (const baseUrl of ['https://example.com/api?x=1', 'https://example.com/api#top', '/api?']) {
      expect(() => createClient(appApi, { baseUrl })).toThrow(
        new TypeError(`[@laratype/client] createClient: baseUrl "${baseUrl}" must not have a query or a hash`),
      )
    }
    const options: ClientOptions = { fetch: fakeFetch().fetch }
    const api = createClient(appApi, options)
    options.baseUrl = 'https://example.com?x=1'
    await expect(api.users.index()).rejects.toThrow(/must not have a query or a hash/)
  })

  it('rejects a hand-made object: only the root that defineApi brands is the appApi (C10 #258)', () => {
    const error = new TypeError('[@laratype/client] createClient: expected the appApi from defineApi, an API node, a contract or the generated manifest')
    // @ts-expect-error a node under another key
    expect(() => createClient({ posts: appApi.users.posts })).toThrow(error)
    // @ts-expect-error a contract in an object
    expect(() => createClient({ users })).toThrow(error)
    // @ts-expect-error a mix
    expect(() => createClient({ users: appApi.users, other: users })).toThrow(error)
    // @ts-expect-error the root's own nodes under their own names, or a copy of the root, carry no root brand
    expect(() => createClient({ users: appApi.users })).toThrow(error)
    // a spread drops the non-enumerable brand at runtime (its type keeps it, so this one compiles)
    expect(() => createClient({ ...appApi })).toThrow(error)
  })

  it('rejects a single endpoint with a clear error, not as a bad manifest', () => {
    // @ts-expect-error not one of the four inputs
    expect(() => createClient(users.show)).toThrow(
      new TypeError('[@laratype/client] createClient: got a single endpoint; pass its contract, an API node or the appApi'),
    )
  })

  it('rejects anything else', () => {
    // @ts-expect-error not one of the four inputs
    expect(() => createClient({ nope: 1 })).toThrow(
      new TypeError('[@laratype/client] createClient: expected the appApi from defineApi, an API node, a contract or the generated manifest'),
    )
  })
})

describe('options and hooks', () => {
  it('headers can be a function, sync or async, called at each call; the call headers still override it', async () => {
    const { fetch, calls } = fakeFetch()
    let token = 'a'
    const headers = vi.fn(() => ({ authorization: `Bearer ${token}`, 'x-tenant': 'default' }))
    const api = createClient(appApi, { fetch, headers })
    await api.users.index()
    token = 'b'
    await api.users.store({ body: { name: 'Ada', email: 'a@b.c' }, headers: { 'x-tenant': 't1' } })
    await createClient(appApi, { fetch, headers: async () => new Headers({ authorization: 'Bearer c' }) }).users.index()
    expect(headers).toHaveBeenCalledTimes(2)
    expect(calls.map((c) => c.headers)).toEqual([
      { authorization: 'Bearer a', 'x-tenant': 'default' },
      { authorization: 'Bearer b', 'content-type': 'application/json', 'x-tenant': 't1' },
      { authorization: 'Bearer c' },
    ])
  })

  it('a headers function that throws or rejects rejects the call, before fetch', async () => {
    const { fetch } = fakeFetch()
    const failure = new Error('no token')
    await expect(createClient(appApi, { fetch, headers: () => { throw failure } }).users.index()).rejects.toBe(failure)
    await expect(createClient(appApi, { fetch, headers: () => Promise.reject(failure) }).users.index()).rejects.toBe(failure)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sets credentials on every call when given, and leaves fetch\'s default otherwise', async () => {
    const { fetch } = fakeFetch()
    const options: ClientOptions = { fetch, credentials: 'include' }
    const api = createClient(appApi, options)
    await api.users.index()
    options.credentials = undefined
    await api.users.index()
    expect(fetch.mock.calls.map(([, init]) => init.credentials)).toEqual(['include', undefined])
    expect('credentials' in fetch.mock.calls[1]![1]).toBe(false)
  })

  it('sends redirect: "manual" by default, so a fetch that rejects on "error" still resolves', async () => {
    const modes: Array<RequestRedirect | undefined> = []
    const fetch = vi.fn<FetchLike>(async (_input, init) => {
      modes.push(init.redirect)
      if (init.redirect === 'error') throw new TypeError('redirect: "error" is not supported')
      return new Response('{}', { status: 200 })
    })
    const result = await createClient(appApi, { fetch }).users.index()
    expect(result.ok).toBe(true)
    expect(modes).toEqual(['manual'])
  })

  it('passes an opted-in redirect mode through to fetch', async () => {
    const { fetch } = fakeFetch()
    await createClient(appApi, { fetch, redirect: 'follow' }).users.index()
    await createClient(appApi, { fetch, redirect: 'error' }).users.index()
    expect(fetch.mock.calls.map(([, init]) => init.redirect)).toEqual(['follow', 'error'])
  })

  it('onRequest setting request.init.redirect wins over options.redirect', async () => {
    const { fetch } = fakeFetch()
    const api = createClient(appApi, {
      fetch,
      redirect: 'error',
      onRequest: ({ init }) => void (init.redirect = 'follow'),
    })
    await api.users.index()
    expect(fetch.mock.calls[0]![1].redirect).toBe('follow')
  })

  it('reads redirect at each call: mutating the options takes effect on the next call', async () => {
    const { fetch } = fakeFetch()
    const options: ClientOptions = { fetch, redirect: 'follow' }
    const api = createClient(appApi, options)
    await api.users.index()
    options.redirect = 'manual'
    await api.users.index()
    options.redirect = undefined
    await api.users.index()
    expect(fetch.mock.calls.map(([, init]) => init.redirect)).toEqual(['follow', 'manual', 'manual'])
  })

  it('onRequest gets the url and the merged init just before fetch, and may change the init', async () => {
    const { fetch, calls } = fakeFetch()
    const controller = new AbortController()
    const seen: Array<[string, Record<string, string>]> = []
    const api = createClient(appApi, {
      fetch,
      baseUrl: 'https://example.com',
      headers: { 'x-tenant': 'default' },
      onRequest: async ({ url, init }) => {
        seen.push([url, Object.fromEntries(init.headers)])
        await Promise.resolve()
        init.headers.set('x-signature', 'sig')
        init.signal = controller.signal
      },
    })
    await api.users.store({ body: { name: 'Ada', email: 'a@b.c' }, headers: { 'x-tenant': 't1' } })
    expect(seen).toEqual([['https://example.com/api/users', { 'content-type': 'application/json', 'x-tenant': 't1' }]])
    expect(calls[0]!.url).toBe('https://example.com/api/users')
    expect(calls[0]!.headers).toEqual({ 'content-type': 'application/json', 'x-signature': 'sig', 'x-tenant': 't1' })
    expect(calls[0]!.signal).toBe(controller.signal)
  })

  it('onRequest is not called for a request that fails before it is sent; a throw from it rejects the call', async () => {
    const { fetch } = fakeFetch()
    const onRequest = vi.fn()
    // @ts-expect-error runtime check
    await expect(createClient(appApi, { fetch, onRequest }).users.show({ params: {} })).rejects.toThrow(/missing param "user"/)
    expect(onRequest).not.toHaveBeenCalled()
    const failure = new Error('hook failed')
    await expect(createClient(appApi, { fetch, onRequest: () => { throw failure } }).users.index()).rejects.toBe(failure)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('onResponse gets every response with its request, before the client reads the body', async () => {
    const order: string[] = []
    const fetch = vi.fn<FetchLike>(async () => {
      order.push('fetch')
      return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'gone' }), { status: 404 })
    })
    const bodies: unknown[] = []
    const api = createClient(appApi, {
      fetch,
      onRequest: () => void order.push('onRequest'),
      onResponse: async (response, request) => {
        order.push('onResponse')
        expect(response.bodyUsed).toBe(false)
        expect(request.url).toBe('/api/users/1')
        bodies.push(await response.clone().json())
      },
    })
    const result = await api.users.show({ params: { user: 1 } })
    expect(order).toEqual(['onRequest', 'fetch', 'onResponse'])
    expect(bodies).toEqual([{ code: 'NOT_FOUND', message: 'gone' }])
    expect(result).toMatchObject({ ok: false, status: 404, code: 'NOT_FOUND', error: { message: 'gone' } })
  })

  it('onResponse is not called when fetch rejects; a throw from it rejects the call', async () => {
    const offline = new TypeError('Failed to fetch')
    const onResponse = vi.fn()
    const result = await createClient(appApi, { fetch: () => Promise.reject(offline), onResponse }).users.index()
    expect(result).toMatchObject({ ok: false, unexpected: true, status: 0, error: offline })
    expect(onResponse).not.toHaveBeenCalled()
    const failure = new Error('hook failed')
    const api = createClient(appApi, { fetch: fakeFetch([]).fetch, onResponse: () => Promise.reject(failure) })
    await expect(api.users.index()).rejects.toBe(failure)
  })

  it('a request that fails its checks never calls the headers function', async () => {
    const headers = vi.fn(() => ({ authorization: 'Bearer t' }))
    vi.stubGlobal('fetch', vi.fn())
    try {
      await expect(createClient(appApi, { headers }).users.index()).rejects.toThrow(/relative URL "\/api\/users"/)
    } finally {
      vi.unstubAllGlobals()
    }
    // @ts-expect-error runtime check
    await expect(createClient(appApi, { fetch: fakeFetch().fetch, headers }).users.index({ body: { x: 1 } })).rejects.toThrow(/a GET request cannot have a body/)
    expect(headers).not.toHaveBeenCalled()
  })

  it('a body that onRequest puts on a GET or HEAD rejects the call, and is not taken for a network failure', async () => {
    const { fetch } = fakeFetch()
    const api = createClient(appApi, { fetch, onRequest: ({ init }) => void (init.body = 'x') })
    await expect(api.users.index()).rejects.toThrow('[@laratype/client] a GET request cannot have a body: "/api/users"')
    // a POST whose method onRequest removes: fetch's default is GET
    const unset = createClient(appApi, { fetch, onRequest: ({ init }) => void delete init.method })
    await expect(unset.users.store({ body: { name: 'A', email: 'a' }, headers: { 'x-tenant': 't' } })).rejects.toThrow(/a GET request cannot have a body/)
    const head = createClient(appApi, { fetch, onRequest: ({ init }) => void (init.method = 'head') })
    await expect(head.users.store({ body: { name: 'A', email: 'a' }, headers: { 'x-tenant': 't' } })).rejects.toThrow(/a HEAD request cannot have a body/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('the request is frozen: onRequest changes the init, not the url or the init object', async () => {
    const { fetch } = fakeFetch()
    const api = createClient(appApi, {
      fetch,
      onRequest: (request) => {
        expect(Object.isFrozen(request)).toBe(true)
        expect(() => Object.assign(request, { url: '/other' })).toThrow(TypeError)
      },
    })
    await api.users.index()
    expect(fetch.mock.calls[0]![0]).toBe('/api/users')
  })

  it('a call aborted before fetch resolves as status 0, and runs no step after the abort', async () => {
    const { fetch } = fakeFetch()
    const onRequest = vi.fn()
    const controller = new AbortController()
    const headers = vi.fn(async () => {
      controller.abort()
      return {}
    })
    const api = createClient(appApi, { fetch, headers, onRequest })
    const result = await api.users.index({ signal: controller.signal })
    expect(result).toEqual({ ok: false, unexpected: true, status: 0, error: controller.signal.reason, response: undefined })
    // already aborted: not even the headers function runs
    expect(await api.users.index({ signal: controller.signal })).toMatchObject({ status: 0, error: controller.signal.reason })
    expect(headers).toHaveBeenCalledTimes(1)
    expect(onRequest).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a throw from onResponse cancels the unread body; an onResponse that reads the body rejects the call', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ cancel })
    const failure = new Error('hook failed')
    const api = createClient(appApi, { fetch: async () => new Response(body, { status: 500 }), onResponse: () => { throw failure } })
    await expect(api.users.index()).rejects.toBe(failure)
    expect(cancel).toHaveBeenCalled()
    const reading = createClient(appApi, { fetch: fakeFetch([]).fetch, onResponse: async (response) => void (await response.text()) })
    await expect(reading.users.index()).rejects.toThrow('[@laratype/client] onResponse read the response body: read a response.clone() instead')
    const locking = createClient(appApi, { fetch: fakeFetch([]).fetch, onResponse: (response) => void response.body!.getReader() })
    await expect(locking.users.index()).rejects.toThrow(/onResponse read the response body/)
  })

  it('a body the injected fetch already used is not blamed on onResponse: the result is unexpected', async () => {
    const fetch = async () => {
      const response = new Response('[]')
      await response.text()
      return response
    }
    const result = await createClient(appApi, { fetch, onResponse: () => {} }).users.index()
    expect(result).toMatchObject({ ok: false, unexpected: true, status: 200 })
  })

  it('reads the options once, when the call starts: a change during the headers function applies to the next call', async () => {
    const first = fakeFetch([])
    const second = fakeFetch([])
    const options: ClientOptions = {
      fetch: first.fetch,
      headers: async () => {
        Object.assign(options, { fetch: second.fetch, credentials: 'omit' })
        return {}
      },
    }
    await createClient(appApi, options).users.index()
    expect(first.fetch.mock.calls[0]![1].credentials).toBeUndefined()
    expect(second.fetch).not.toHaveBeenCalled()
  })

  it('reads credentials and the hooks from the options at each call', async () => {
    const { fetch } = fakeFetch([])
    const options: ClientOptions = { fetch }
    const api = createClient(appApi, options)
    await api.users.index()
    const onRequest = vi.fn()
    const onResponse = vi.fn()
    Object.assign(options, { credentials: 'omit', onRequest, onResponse })
    await api.users.index()
    expect(onRequest).toHaveBeenCalledTimes(1)
    expect(onResponse).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[1]![1].credentials).toBe('omit')
  })
})

/** A fetch answering with a raw body, for the result union. */
const respond = (body: BodyInit | null, status = 200) => vi.fn<FetchLike>(async () => new Response(body, { status }))
const json = (value: unknown, status = 200) => respond(JSON.stringify(value), status)

describe('the result union', () => {
  it('success: ok, the declared status and the parsed JSON body; the body is read once, so response.bodyUsed', async () => {
    const api = createClient(appApi, { fetch: json([{ id: 1, title: 'T' }]) })
    const result = await api.users.posts.index({ params: { user: 1 } })
    expect(result).toEqual({ ok: true, status: 200, data: [{ id: 1, title: 'T' }], response: expect.any(Response) })
    expect(result.response!.bodyUsed).toBe(true)
    expect(result.response!.headers).toBeInstanceOf(Headers)
  })

  it('a 2xx other than the declared status is unexpected, with the response: 200 for a declared 201', async () => {
    const result = await createClient(appApi, { fetch: json({ id: 1 }, 200) }).users.store({ body: { name: 'A', email: 'a@b.c' } })
    expect(result).toEqual({ ok: false, unexpected: true, status: 200, error: { id: 1 }, response: expect.any(Response) })
  })

  it('an empty 200 where a response schema is declared is unexpected, with the response', async () => {
    const result = await createClient(appApi, { fetch: respond('', 200) }).v1.health.check()
    expect(result).toMatchObject({ ok: false, unexpected: true, status: 200, response: expect.any(Response) })
    expect((result as { error: Error }).error.message).toBe('[@laratype/client] empty 200 body: the endpoint declares a response')
  })

  it('a body-less 202 declared with .status(): ok with data undefined, the unread body cancelled to free the connection', async () => {
    const jobs = defineContract()({ start: endpoint.post('/jobs').status(202) })
    let cancelled = false
    const stream = new ReadableStream({ cancel: () => void (cancelled = true) })
    const result = await createClient(jobs, { fetch: async () => new Response(stream, { status: 202 }) }).start()
    expect(result).toEqual({ ok: true, status: 202, data: undefined, response: expect.any(Response) })
    expect(cancelled).toBe(true)
    expect(await createClient(jobs, { fetch: respond(null, 204) }).start()).toMatchObject({ ok: false, unexpected: true, status: 204 })
  })

  it('a declared 205 (Reset Content) is body-less too: ok with data undefined, its null body not cancelled', async () => {
    const forms = defineContract()({ reset: endpoint.post('/form').status(205) })
    const response = new Response(null, { status: 205 })
    const result = await createClient(forms, { fetch: async () => response }).reset()
    expect(result).toEqual({ ok: true, status: 205, data: undefined, response })
    expect(response.bodyUsed).toBe(false)
  })

  it('a declared 204, or an endpoint with no response schema (204 by default): ok with data undefined', async () => {
    const things = defineContract()({
      remove: endpoint.delete('/:id').status(204),
      ping: endpoint.post('/ping'),
    })
    const removed = await createClient(things, { fetch: respond(null, 204) }).remove({ params: { id: 1 } })
    expect(removed).toEqual({ ok: true, status: 204, data: undefined, response: expect.any(Response) })
    const pinged = await createClient(things, { fetch: respond(null, 204) }).ping()
    expect(pinged).toEqual({ ok: true, status: 204, data: undefined, response: expect.any(Response) })
    // a schema-less endpoint answering 200 breaks the contract (http.md: 204 without a response schema)
    expect(await createClient(things, { fetch: respond('pong', 200) }).ping()).toMatchObject({ ok: false, unexpected: true, status: 200 })
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

  it('a code declared with two statuses classifies both (a .throws(410 NOT_FOUND) next to the derived 404)', async () => {
    const Gone = defineError(410, 'NOT_FOUND')
    const files = defineContract()({ show: endpoint.get('/:file').throws(Gone).response(z.object({ name: z.string() })) })
    const api = (status: number) => createClient(files, { fetch: json({ code: 'NOT_FOUND', message: 'x' }, status) })
    expect(await api(404).show({ params: { file: 'a' } })).toMatchObject({ ok: false, status: 404, code: 'NOT_FOUND' })
    expect(await api(410).show({ params: { file: 'a' } })).toMatchObject({ ok: false, status: 410, code: 'NOT_FOUND' })
    expect(await api(400).show({ params: { file: 'a' } })).toMatchObject({ ok: false, unexpected: true, status: 400 })
  })

  it('the server 500 { message: "Server Error" } has no code, so it is unexpected', async () => {
    const result = await createClient(appApi, { fetch: json({ message: 'Server Error' }, 500) }).users.index()
    expect(result).toEqual({ ok: false, unexpected: true, status: 500, error: { message: 'Server Error' }, response: expect.any(Response) })
  })

  it('a non-JSON body is unexpected, on a 2xx or an error status, and keeps its text since the body is consumed', async () => {
    const ok = await createClient(appApi, { fetch: respond('<html>ok</html>', 200) }).v1.health.check()
    expect(ok).toEqual({
      ok: false,
      unexpected: true,
      status: 200,
      error: expect.any(SyntaxError),
      response: expect.any(Response),
      text: '<html>ok</html>',
    })
    const badGateway = await createClient(appApi, { fetch: respond('Bad Gateway', 502) }).users.index()
    expect(badGateway).toMatchObject({ ok: false, unexpected: true, status: 502, error: expect.any(SyntaxError), text: 'Bad Gateway' })
  })

  it('under the default redirect: "manual", a real 3xx is unexpected with its status and response (Node, Bun, Deno, workerd)', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response(null, { status: 302, headers: { location: '/login' } }))
    const result = await createClient(appApi, { fetch }).users.index()
    expect(fetch.mock.calls[0]![1].redirect).toBe('manual')
    expect(result).toMatchObject({ ok: false, unexpected: true, status: 302, response: expect.any(Response) })
    expect(result.response!.headers.get('location')).toBe('/login')
  })

  it('under the default redirect: "manual", a browser opaqueredirect is status 0 with its response', async () => {
    const opaque = new Response(null, { status: 200 })
    Object.defineProperties(opaque, { status: { value: 0 }, ok: { value: false }, type: { value: 'opaqueredirect' } })
    const fetch = vi.fn<FetchLike>(async () => opaque)
    const result = await createClient(appApi, { fetch }).users.index()
    expect(fetch.mock.calls[0]![1].redirect).toBe('manual')
    expect(result).toMatchObject({ ok: false, unexpected: true, status: 0, response: opaque })
    expect(result.response!.type).toBe('opaqueredirect')
  })

  it('resolves the "error" opt-in rejection as the status-0 unexpected result without a response', async () => {
    const failure = new TypeError('Failed to fetch')
    const fetch = vi.fn<FetchLike>(async (_input, init) => {
      if (init.redirect === 'error') throw failure
      return new Response('{}', { status: 200 })
    })
    const result = await createClient(appApi, { fetch, redirect: 'error' }).users.index()
    expect(fetch.mock.calls[0]![1].redirect).toBe('error')
    expect(result).toEqual({ ok: false, unexpected: true, status: 0, error: failure, response: undefined })
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

  it('an error while the body is read, after the headers arrived, is unexpected with the HTTP status and response', async () => {
    const reading = new TypeError('network error while reading')
    const fetch = vi.fn<FetchLike>(async () => new Response(new ReadableStream({ start: (c) => c.error(reading) }), { status: 200 }))
    const result = await createClient(appApi, { fetch }).v1.health.check()
    expect(result).toEqual({ ok: false, unexpected: true, status: 200, error: reading, response: expect.any(Response) })
  })

  it('a contract whose .authorize() gets auth from a folder scope declares its own errors (no 401 alone)', async () => {
    const scoped = defineContract<Prefix>()({ destroy: endpoint.delete('/:post').authorize() })
    const api = (body: unknown, status: number) => createClient(scoped, { fetch: json(body, status), baseUrl: 'https://example.com/api/users/1/posts' })
    expect(await api({ code: 'FORBIDDEN', message: 'No.' }, 403).destroy({ params: { post: 2 } })).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(await api({ code: 'NOT_FOUND', message: 'x' }, 404).destroy({ params: { post: 2 } })).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    // auth comes from the scope, which a contract alone doesn't have
    expect(await api({ code: 'UNAUTHORIZED', message: 'x' }, 401).destroy({ params: { post: 2 } })).toMatchObject({ ok: false, unexpected: true })
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
    expect(Object.keys(api.users)).toEqual(['destroy', 'index', 'posts', 'show', 'store'])
    expect(Object.isFrozen(api.users.posts)).toBe(true)

    await api.users.posts.update({ params: { user: 'a/b', post: 2 }, body: { title: 'T' } })
    await api.users.index({ query: { page: 3 } })
    await api.v1.health.check()
    await api.users.destroy({ params: { user: 1 } })
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['PATCH', 'https://api.example.com/api/users/a%2Fb/posts/2', '{"title":"T"}'],
      ['GET', 'https://api.example.com/api/users?page=3', undefined],
      ['GET', 'https://api.example.com/api/v1/health', undefined],
      ['DELETE', 'https://api.example.com/api/users/1', undefined],
    ])
    expect(calls[0]!.headers['content-type']).toBe('application/json')
  })

  it('applies the success status and the body flag of a generated manifest', async () => {
    const store = { body: { name: 'A', email: 'a' } }
    const user = {
      id: 1,
      name: 'A',
      role: 'admin' as const,
      address: { street: 's' },
      tags: [],
      pair: [1, 'a'] as [number, string],
      meta: {},
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    expect(await createClient<AppApi>(manifest, { fetch: json(user, 201) }).users.store(store)).toMatchObject({ ok: true, status: 201, data: user })
    // 200 is not the declared 201
    expect(await createClient<AppApi>(manifest, { fetch: json({ id: 1 }, 200) }).users.store(store)).toMatchObject({
      ok: false,
      unexpected: true,
      status: 200,
      error: { id: 1 },
    })
    // an empty body where the manifest declares a response
    const empty = await createClient<AppApi>(manifest, { fetch: respond('', 200) }).v1.health.check()
    expect(empty).toMatchObject({ ok: false, unexpected: true, status: 200 })
    expect((empty as { error: unknown }).error).toBeInstanceOf(TypeError)
    // response: false: a 202 answers undefined without a schema, and any other 2xx is unexpected
    expect(await createClient<AppApi>(manifest, { fetch: json({ ignored: true }, 202) }).users.destroy({ params: { user: 1 } })).toMatchObject({
      ok: true,
      status: 202,
      data: undefined,
    })
    expect(await createClient<AppApi>(manifest, { fetch: json({}, 200) }).users.destroy({ params: { user: 1 } })).toMatchObject({
      ok: false,
      unexpected: true,
      status: 200,
    })
  })

  it('classifies errors by code and by status, as the contract client does', async () => {
    const api = (body: unknown, status: number) => createClient<AppApi>(manifest, { fetch: json(body, status) })
    const store = { body: { name: 'A', email: 'a' } }
    expect(await api({ code: 'EMAIL_TAKEN', message: 'x', email: 'a' }, 409).users.store(store)).toMatchObject({
      ok: false,
      code: 'EMAIL_TAKEN',
      error: { message: 'x', email: 'a' },
    })
    // the code is declared at 409 only
    expect(await api({ code: 'EMAIL_TAKEN', message: 'x', email: 'a' }, 400).users.store(store)).toMatchObject({ ok: false, unexpected: true, status: 400 })
    // ACCOUNT_LOCKED is declared under users/[user], not on users.store
    expect(await api({ code: 'ACCOUNT_LOCKED', message: 'x' }, 403).users.store(store)).toMatchObject({ ok: false, unexpected: true })
    expect(await api({ ok: true }, 200).v1.health.check()).toMatchObject({ ok: true, data: { ok: true } })
  })

  it('a code declared at two statuses matches both, and only those', async () => {
    const two = {
      'a.b': {
        method: 'get',
        path: '/x',
        status: 200,
        response: true,
        errors: [
          { status: 404, code: 'MISSING' },
          { status: 410, code: 'MISSING' },
          { status: 409, code: 'TAKEN' },
          // a string entry keeps the pre-CL8 any-4xx/5xx rule for its code, next to object entries
          'TAKEN',
        ],
      },
    }
    type Calls = { a: { b: () => Promise<{ ok: boolean; code?: string; unexpected?: boolean; status: number }> } }
    const api = (status: number) => createClient(two, { fetch: json({ code: 'MISSING' }, status) }) as never as Calls
    expect(await api(404).a.b()).toMatchObject({ ok: false, code: 'MISSING', status: 404 })
    expect(await api(410).a.b()).toMatchObject({ ok: false, code: 'MISSING', status: 410 })
    expect(await api(400).a.b()).toMatchObject({ ok: false, unexpected: true })
    // TAKEN is any 4xx/5xx because of its string entry
    const taken = (status: number) => createClient(two, { fetch: json({ code: 'TAKEN' }, status) }) as never as Calls
    expect(await taken(418).a.b()).toMatchObject({ ok: false, code: 'TAKEN', status: 418 })
  })

  it('a 3xx is unexpected even when its body carries a declared code', async () => {
    const result = await createClient<AppApi>(manifest, { fetch: json({ code: 'EMAIL_TAKEN', message: 'x' }, 302) }).users.store({
      body: { name: 'A', email: 'a' },
    })
    expect(result).toMatchObject({ ok: false, unexpected: true, status: 302, error: { code: 'EMAIL_TAKEN', message: 'x' } })
  })

  it('accepts a manifest generated before CL8: no status/response, string errors, lenient answers', async () => {
    const legacy = { 'a.b': { method: 'get', path: '/api/a', errors: ['NOT_FOUND'] } }
    type Calls = { a: { b: () => Promise<{ ok: boolean; status: number; code?: string; unexpected?: boolean; data?: unknown }> } }
    const api = (body: unknown, status: number) => createClient(legacy, { fetch: json(body, status) }) as never as Calls
    // any 2xx, the body parsed if there is one
    expect(await api({ ok: true }, 203).a.b()).toMatchObject({ ok: true, status: 203, data: { ok: true } })
    // a code string matches any 4xx or 5xx
    expect(await api({ code: 'NOT_FOUND', message: 'x' }, 410).a.b()).toMatchObject({ ok: false, code: 'NOT_FOUND', status: 410 })
    expect(await api({ code: 'NOT_FOUND' }, 302).a.b()).toMatchObject({ ok: false, unexpected: true, status: 302 })
  })

  it('validates the route method, path, status and body flag at createClient, naming the key', () => {
    const route = { method: 'get', path: '/x' }
    const message = (text: string) => new TypeError(`[@laratype/client] createClient: "a.b": ${text}`)
    const cases: Array<[unknown, TypeError]> = [
      [{ ...route, method: 'fetch' }, message('the method must be one of get, post, put, patch, delete, got "fetch"')],
      [{ ...route, method: 42 }, message('the method must be one of get, post, put, patch, delete, got 42')],
      [{ ...route, path: 'x' }, message('the path must start with one "/" and must not contain control characters, got "x"')],
      [{ ...route, path: '' }, message('the path must start with one "/" and must not contain control characters, got ""')],
      [{ ...route, path: '//evil.com/x' }, message('the path must start with one "/" and must not contain control characters, got "//evil.com/x"')],
      [{ ...route, path: '/\\evil.com/x' }, message('the path must start with one "/" and must not contain control characters, got "/\\\\evil.com/x"')],
      [{ ...route, path: '/\t/evil.com/x' }, message('the path must start with one "/" and must not contain control characters, got "/\\t/evil.com/x"')],
      [{ ...route, status: 99 }, message('the status must be an integer from 100 to 599, got 99')],
      [{ ...route, status: 600 }, message('the status must be an integer from 100 to 599, got 600')],
      [{ ...route, status: 404 }, message('the status must be a 2xx success status (200-299), got 404')],
      [{ ...route, status: '200' }, message('the status must be an integer from 100 to 599, got "200"')],
      [{ ...route, status: Number.NaN }, message('the status must be an integer from 100 to 599, got NaN')],
      [{ ...route, status: Infinity }, message('the status must be an integer from 100 to 599, got Infinity')],
      [{ ...route, response: 'yes' }, message('response must be a boolean, got "yes"')],
      [{ ...route, status: 204, response: true }, message('a 204 or 205 has no body; response must be false')],
    ]
    for (const [value, error] of cases) expect(() => createClient({ 'a.b': value } as never)).toThrow(error)
    // a route with neither field, or not an object at all, is still named instead of the generic "expected ..." error
    expect(() => createClient({ 'a.b': {} } as never)).toThrow(
      message('the method must be one of get, post, put, patch, delete, got undefined'),
    )
    expect(() => createClient({ 'a.b': null } as never)).toThrow(message('a route must be a plain object, got null'))
  })

  it('checks the manifest errors at createClient: an array of codes or { status, code } entries', () => {
    const route = { method: 'get', path: '/x' }
    const message = (text: string) => new TypeError(`[@laratype/client] createClient: "a.b": ${text}`)
    const cases: Array<[unknown, TypeError]> = [
      ['NOT_FOUND', message('errors must be an array of error codes (strings) or { status, code } entries, got "NOT_FOUND"')],
      [{ 0: 'X' }, message('errors must be an array of error codes (strings) or { status, code } entries, got an object')],
      [{ length: 1e9 }, message('errors must be an array of error codes (strings) or { status, code } entries, got an object')],
      [[404], message('errors[0] must be an error code (a non-empty string) or { status, code }, got 404')],
      [[null], message('errors[0] must be an error code (a non-empty string) or { status, code }, got null')],
      [[''], message('errors[0] must be an error code (a non-empty string) or { status, code }, got ""')],
      [[{}], message('errors[0].status must be an integer from 400 to 599, got undefined')],
      [[{ status: 600, code: 'X' }], message('errors[0].status must be an integer from 400 to 599, got 600')],
      [[{ status: Number.NaN, code: 'X' }], message('errors[0].status must be an integer from 400 to 599, got NaN')],
      [[{ status: 401 }], message('errors[0].code must be a non-empty string, got undefined')],
      [[{ status: 401, code: '' }], message('errors[0].code must be a non-empty string, got ""')],
    ]
    for (const [errors, error] of cases) expect(() => createClient({ 'a.b': { ...route, errors } } as never)).toThrow(error)
    // 1000 is the cap, checked from length before any entry is read: a sparse 1e9 array is refused, not walked
    expect(() => createClient({ 'a.b': { ...route, errors: new Array(1e9) } } as never)).toThrow(
      message('errors has 1000000000 entries, more than the 1000 supported'),
    )
    // absent, duplicates and the same code at two statuses are fine
    expect(() => createClient({ 'a.b': route })).not.toThrow()
    expect(() =>
      createClient({ 'a.b': { ...route, errors: [{ status: 401, code: 'X' }, { status: 401, code: 'X' }, { status: 403, code: 'X' }, 'X'] } } as never),
    ).not.toThrow()
  })

  it('rejects a manifest or route that is not a plain object', () => {
    const route = { method: 'get', path: '/x' }
    expect(() => createClient(new Map([['a.b', route]]) as never)).toThrow(
      '[@laratype/client] createClient: the manifest must be a plain object, got a Map',
    )
    expect(() => createClient([] as never)).toThrow('[@laratype/client] createClient: the manifest must be a plain object, got an array')
    expect(() => createClient(Object.assign(Object.create({}), { 'a.b': route }) as never)).toThrow(
      '[@laratype/client] createClient: the manifest must be a plain object, got a non-plain object',
    )
    class Route {
      method = 'get'
      path = '/x'
    }
    expect(() => createClient({ 'a.b': new Route() } as never)).toThrow(
      '[@laratype/client] createClient: "a.b": a route must be a plain object, got an instance of Route',
    )
    // an object whose __proto__ is set carries no own route and is not plain
    expect(() => createClient({ __proto__: { 'a.b': route } } as never)).toThrow(/the manifest must be a plain object/)
  })

  it('keeps __proto__ and constructor route names as ordinary keys', async () => {
    const manifest = {
      'a.__proto__.b': { method: 'get', path: '/api/proto' },
      'a.constructor.b': { method: 'get', path: '/api/ctor' },
    }
    const { fetch, calls } = fakeFetch()
    const api = createClient(manifest, { fetch, baseUrl: 'https://api.example.com' }) as never as {
      a: Record<string, { b: () => Promise<unknown> }>
    }
    await api.a['__proto__']!.b()
    await api.a['constructor']!.b()
    expect(Object.getPrototypeOf(api)).toBeNull()
    expect(Object.keys(api.a)).toEqual(['__proto__', 'constructor'])
    expect(calls.map((c) => c.url)).toEqual(['https://api.example.com/api/proto', 'https://api.example.com/api/ctor'])
    // no prototype pollution: Object.prototype gained nothing
    expect(({} as { b?: unknown }).b).toBeUndefined()
  })

  it('snapshots each route field once: a Proxy or a getter cannot change it later', async () => {
    let reads = 0
    const getter = {
      get method() {
        reads++
        return reads === 1 ? 'get' : 'post'
      },
      path: '/api/x',
    }
    const first = createClient({ 'a.b': getter }, { fetch: fakeFetch().fetch }) as never as { a: { b: () => Promise<unknown> } }
    expect(reads).toBe(1)
    await first.a.b()

    let methodReads = 0
    const proxy = new Proxy(
      { method: 'get', path: '/api/y' },
      {
        get(target, key, receiver) {
          if (key === 'method') return ['get', 'post', 'delete'][methodReads++] ?? 'delete'
          return Reflect.get(target, key, receiver) as unknown
        },
      },
    )
    const second = createClient({ 'a.b': proxy }, { fetch: fakeFetch().fetch }) as never as { a: { b: () => Promise<unknown> } }
    expect(methodReads).toBe(1)
    await second.a.b()
  })

  it('never echoes a long or non-finite value raw', () => {
    const long = 'x'.repeat(10_000)
    let error = ''
    try {
      createClient({ 'a.b': { method: 'get', path: long } } as never)
    } catch (e) {
      error = (e as Error).message
    }
    expect(error).toContain('the path must start with one "/"')
    expect(error).not.toContain(long)
    expect(error.length).toBeLessThan(300)
    // a long key is truncated too
    let keyError = ''
    try {
      createClient({ [long]: { method: 'get', path: '/x' } } as never)
    } catch (e) {
      keyError = (e as Error).message
    }
    expect(keyError).toContain('invalid route name')
    expect(keyError).not.toContain(long)
    // a lone surrogate is escaped by the diagnostic
    expect(() => createClient({ 'a.\ud800': { method: 'get', path: 'x' } } as never)).toThrow(
      '[@laratype/client] createClient: "a.\\ud800": the path must start with one "/" and must not contain control characters, got "x"',
    )
  })

  it('rejects a manifest with bad route names', () => {
    const route = { method: 'get', path: '/x' }
    expect(() => createClient({ health: route })).toThrow('[@laratype/client] createClient: invalid route name "health" in the manifest')
    expect(() => createClient({ 'a.b': route, 'a.b.c': route })).toThrow('createClient: "a.b.c" is under the endpoint "b" in the manifest')
    expect(() => createClient({ 'a.b.c': route, 'a.b': route })).toThrow('createClient: "a.b" is both an endpoint and a node in the manifest')
    // a control character in a key
    expect(() => createClient({ 'a.\tb': route } as never)).toThrow('createClient: invalid route name "a.\\tb" in the manifest')
  })

  it('the key is authoritative: a route whose own name disagrees is refused', () => {
    const route = { method: 'get', path: '/x' }
    expect(() => createClient({ 'a.b': { ...route, name: 'a.b' } } as never)).not.toThrow()
    expect(() => createClient({ 'a.b': { ...route, name: 'a.c' } } as never)).toThrow(
      '[@laratype/client] createClient: "a.b": the route name "a.c" does not match its manifest key',
    )
  })
})
