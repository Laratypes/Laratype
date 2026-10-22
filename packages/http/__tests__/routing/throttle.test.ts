// H17 #229: the rate limit from the contract's .throttle() flag
// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { defineApi, defineContract, defineScope, endpoint } from '@laratype/contract'
import type { ContractPrefix } from '@laratype/contract'
import { Controller, RequestKernel, ResponseKernel, Route } from '../../src/index'
import { MemoryThrottleStore, durationMs, ipBucket, throttled } from '../../src/routing/api/throttle'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const

// app/api/_scope.ts { throttle: 3 per minute }, app/api/posts.ts with endpoint-level overrides
const root = defineScope()({ throttle: { limit: 3, per: '1m' } })
const posts = defineContract<ContractPrefix<'/api', [typeof root]>>()({
  index: endpoint.get('/').response(anything),
  show: endpoint.get('/:id').response(anything).throttle({ limit: 1, per: 10 }),
  open: endpoint.get('/open/all').response(anything).throttle(false),
})
const users = defineContract()({ index: endpoint.get('/').response(anything) })
const appApi = defineApi({
  posts: { contract: posts, path: '/api/posts', scopes: [root], dirs: [''] },
  users: { contract: users, path: '/users', scopes: [], dirs: [] },
})

class PostController extends Controller {
  index() { return { posts: [] } }
  show() { return { post: 1 } }
  open() { return { open: true } }
}
class UserController extends Controller {
  index() { return { users: [] } }
}

const routes = () => Route.api(appApi, (r) => [r.contract(posts, PostController), r.contract(users, UserController)])

/** An app booted like `sauf dev`: ResponseKernel's resolveException answers thrown errors. */
const bootApp = () => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  routes().mount(app)
  return app
}

/** The Bun adapter's env: `request.ip()` reads `server.requestIP()`. */
const from = (address: string) => ({ requestIP: () => ({ address }) })

let app: Hono

beforeAll(() => {
  globalThis.__laratype_route_model_bindings = {}
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  app = bootApp()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// Each test uses its own addresses: the memory store is one per process
describe('rate limit from the contract', () => {
  it('answers 429 with the catalog body and Retry-After once the limit is hit', async () => {
    for (let i = 0; i < 3; i++) expect((await app.request('/api/posts', {}, from('203.0.113.1'))).status).toBe(200)
    vi.advanceTimersByTime(15_000)
    const limited = await app.request('/api/posts', {}, from('203.0.113.1'))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('45')
    expect(limited.headers.get('Content-Type')).toMatch(/^application\/json/)
    expect(await limited.json()).toEqual({ code: 'TOO_MANY_REQUESTS', message: 'Too Many Requests.' })
    // another client keeps its own counter
    expect((await app.request('/api/posts', {}, from('203.0.113.2'))).status).toBe(200)
  })

  it('a new window starts once `per` has passed', async () => {
    for (let i = 0; i < 3; i++) await app.request('/api/posts', {}, from('203.0.113.3'))
    expect((await app.request('/api/posts', {}, from('203.0.113.3'))).status).toBe(429)
    vi.advanceTimersByTime(60_000)
    expect((await app.request('/api/posts', {}, from('203.0.113.3'))).status).toBe(200)
  })

  it('the nearest level wins: the endpoint limit replaces the scope one', async () => {
    expect((await app.request('/api/posts/1', {}, from('203.0.113.4'))).status).toBe(200)
    const limited = await app.request('/api/posts/2', {}, from('203.0.113.4'))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('10')
  })

  it('each route counts its own hits', async () => {
    expect((await app.request('/api/posts/1', {}, from('203.0.113.5'))).status).toBe(200)
    expect((await app.request('/api/posts', {}, from('203.0.113.5'))).status).toBe(200)
  })

  it('an endpoint without .throttle(), or with .throttle(false), is never limited', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await app.request('/users', {}, from('203.0.113.6'))).status).toBe(200)
      expect((await app.request('/api/posts/open/all', {}, from('203.0.113.6'))).status).toBe(200)
    }
  })

  it('IPv6 clients of one /64 share a counter; an IPv4-mapped peer counts as its IPv4 address', async () => {
    await app.request('/api/posts/1', {}, from('2001:db8:1:2::a'))
    expect((await app.request('/api/posts/1', {}, from('2001:db8:1:2:ffff::b'))).status).toBe(429)
    expect((await app.request('/api/posts/1', {}, from('2001:db8:1:3::a'))).status).toBe(200)
    await app.request('/api/posts/1', {}, from('198.51.100.7'))
    expect((await app.request('/api/posts/1', {}, from('::ffff:198.51.100.7'))).status).toBe(429)
  })

  it('a request with no client address is not limited (no shared "" bucket), with one warning', async () => {
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('laratype.http.throttleNoAddressWarned')]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 5; i++) expect((await app.request('/api/posts/1')).status).toBe(200)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('a request has no client address'))
  })

  it('never reads X-Forwarded-For', async () => {
    await app.request('/api/posts/1', { headers: { 'X-Forwarded-For': '192.0.2.1' } }, from('203.0.113.8'))
    expect((await app.request('/api/posts/1', { headers: { 'X-Forwarded-For': '192.0.2.2' } }, from('203.0.113.8'))).status).toBe(429)
  })

  it('answers 429 without the response kernel too (Hono error handler)', async () => {
    const bare = new Hono()
    routes().mount(bare)
    await bare.request('/api/posts/1', {}, from('203.0.113.9'))
    const limited = await bare.request('/api/posts/1', {}, from('203.0.113.9'))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('10')
    expect(await limited.json()).toEqual({ code: 'TOO_MANY_REQUESTS', message: 'Too Many Requests.' })
  })

  it('a .domain() route counts only requests for its host', async () => {
    const onHost = new Hono()
    routes().domain('api.example.test').mount(onHost)
    onHost.get('/api/posts/:id', (c) => c.text('fallback'))
    expect((await onHost.request('http://other.test/api/posts/1', {}, from('203.0.113.10'))).status).toBe(200)
    expect((await onHost.request('http://api.example.test/api/posts/1', {}, from('203.0.113.10'))).status).toBe(200)
    expect((await onHost.request('http://api.example.test/api/posts/1', {}, from('203.0.113.10'))).status).toBe(429)
    expect(await (await onHost.request('http://other.test/api/posts/1', {}, from('203.0.113.10'))).text()).toBe('fallback')
  })

  it('same-named routes of two domains count separately', async () => {
    const both = new Hono()
    routes().domain('a.example.test').mount(both)
    routes().domain('b.example.test').mount(both)
    expect((await both.request('http://a.example.test/api/posts/1', {}, from('203.0.113.11'))).status).toBe(200)
    expect((await both.request('http://b.example.test/api/posts/1', {}, from('203.0.113.11'))).status).toBe(200)
    expect((await both.request('http://a.example.test/api/posts/1', {}, from('203.0.113.11'))).status).toBe(429)
  })

  it('throttled routes are no longer listed as unenforced', () => {
    const entries = routes().routes
    expect(entries.map((e) => [e.name, e.unenforced])).toEqual([
      ['posts.index', []], ['posts.show', []], ['posts.open', []], ['users.index', []],
    ])
  })
})

describe('ipBucket', () => {
  it('keys IPv4 as is, IPv4-mapped as IPv4 and IPv6 by its /64', () => {
    expect(ipBucket('')).toBeUndefined()
    expect(ipBucket('203.0.113.1')).toBe('203.0.113.1')
    expect(ipBucket('::ffff:203.0.113.1')).toBe('203.0.113.1')
    expect(ipBucket('::FFFF:203.0.113.1')).toBe('203.0.113.1')
    expect(ipBucket('0:0:0:0:0:ffff:cb00:7101')).toBe('203.0.113.1')
    expect(ipBucket('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(ipBucket('2001:0DB8:0000:0000:ffff:1:2:3')).toBe('2001:db8:0:0::/64')
    expect(ipBucket('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
    expect(ipBucket('::1')).toBe('0:0:0:0::/64')
    expect(ipBucket('64:ff9b::203.0.113.1')).toBe('203.0.113.1')
    expect(ipBucket('64:ff9b:1::203.0.113.1')).toBe('64:ff9b:1:0::/64')
  })
})

describe('durationMs', () => {
  it('reads seconds and "<n>s|m|h|d"', () => {
    expect(durationMs(30)).toBe(30_000)
    expect(durationMs(0.5)).toBe(500)
    expect(durationMs('30s')).toBe(30_000)
    expect(durationMs('1.5m')).toBe(90_000)
    expect(durationMs('2h')).toBe(7_200_000)
    expect(durationMs('1d')).toBe(86_400_000)
  })
})

describe('MemoryThrottleStore', () => {
  it('counts hits in fixed windows and drops ended windows', () => {
    const store = new MemoryThrottleStore()
    const start = Date.now()
    expect(store.hit('a', 1000)).toEqual({ hits: 1, resetAt: start + 1000 })
    expect(store.hit('a', 1000)).toEqual({ hits: 2, resetAt: start + 1000 })
    vi.advanceTimersByTime(1000)
    expect(store.hit('a', 1000)).toEqual({ hits: 1, resetAt: start + 2000 })
    const windows = (store as unknown as { windows: Map<string, unknown> }).windows
    store.hit('b', 1000)
    expect(windows.size).toBe(2)
    vi.advanceTimersByTime(60_000)
    store.hit('c', 1000)
    expect([...windows.keys()]).toEqual(['c'])
  })

  it('when full, drops the ended windows before a live one', () => {
    const store = new MemoryThrottleStore(2)
    store.hit('a', 1000)
    store.hit('b', 10_000)
    vi.advanceTimersByTime(1000)
    store.hit('c', 10_000)
    const windows = (store as unknown as { windows: Map<string, unknown> }).windows
    expect([...windows.keys()]).toEqual(['b', 'c'])
  })

  it('when full, drops a newer ended window before an older live one', () => {
    const store = new MemoryThrottleStore(2)
    store.hit('a', 60_000)
    store.hit('b', 1000)
    vi.advanceTimersByTime(1000)
    store.hit('c', 60_000)
    const windows = (store as unknown as { windows: Map<string, unknown> }).windows
    expect([...windows.keys()]).toEqual(['a', 'c'])
  })

  it('a full store of live windows sweeps at most once a second', () => {
    const store = new MemoryThrottleStore(2)
    store.hit('a', 60_000)
    store.hit('b', 60_000)
    const sweep = vi.spyOn(store as unknown as { sweep(now: number): void }, 'sweep')
    for (const key of ['c', 'd', 'e']) store.hit(key, 60_000)
    expect(sweep).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    store.hit('f', 60_000)
    expect(sweep).toHaveBeenCalledTimes(2)
  })

  it('keeps at most maxWindows, dropping the window started first', () => {
    const store = new MemoryThrottleStore(2)
    store.hit('a', 10_000)
    store.hit('b', 10_000)
    store.hit('a', 10_000)
    store.hit('c', 10_000)
    const windows = (store as unknown as { windows: Map<string, unknown> }).windows
    expect([...windows.keys()]).toEqual(['b', 'c'])
    expect(store.hit('a', 10_000).hits).toBe(1)
  })
})

describe('throttled', () => {
  it('rejects a window that never ends at mount', () => {
    const route = { name: 'posts.index', method: 'get', path: '/posts', domain: undefined }
    const handle = async () => new Response()
    expect(() => throttled(route, { limit: 1, per: 1e300 }, handle)).toThrow(
      '[@laratype/http] Route.api: posts.index: throttle per must be from 1 second to 9007199254740991 ms, got 1e+300',
    )
    expect(() => throttled(route, { limit: 1, per: 0.5 }, handle)).toThrow(/from 1 second/)
    expect(() => throttled(route, { limit: 1, per: 60 }, handle)).not.toThrow()
  })
})
