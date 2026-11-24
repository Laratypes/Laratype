// H17 #229: the rate limit from the contract's .throttle() flag
// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { cors } from 'hono/cors'
import type { GetConnInfo } from 'hono/conninfo'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { defineApi, defineContract, defineScope, endpoint, errors } from '@laratype/contract'
import type { ContractPrefix } from '@laratype/contract'
import { Controller, defineMiddleware, mountConnInfo, registerContractAuth, RequestKernel, ResponseKernel, Route } from '../../src/index'
import type { ApiRoutes } from '../../src/index'
import { MemoryThrottleStore, clientPrefix, durationMs, ipBucket, throttled } from '../../src/routing/api/throttle'

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
  posts: { contract: posts, path: '/api/posts', scopes: [{ scope: root, dir: '' }] },
  users: { contract: users, path: '/users', scopes: [] },
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

/** The getter the serving adapter registers: this test's request env carries the client address. */
const addressFromEnv = (c: Context) => ({ remote: { address: (c.env as { address?: string }).address } })

/** An app booted like `sauf dev` around `apiRoutes`: ResponseKernel's resolveException answers thrown errors. */
const bootRoutes = (apiRoutes: ApiRoutes, mount: (app: Hono) => void = (app) => mountConnInfo(app, addressFromEnv)) => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  mount(app)
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  apiRoutes.mount(app)
  return app
}

/** An app booted like `sauf dev`: ResponseKernel's resolveException answers thrown errors. */
const boot = (mount: (app: Hono) => void) => bootRoutes(routes(), mount)

/** The app `sauf dev` boots: the adapter's getter reads the client address from the request's env. */
const bootApp = () => boot((app) => mountConnInfo(app, addressFromEnv))

/** The same app with another getter: a throwing one, or one that finds no address. */
const bootAppWith = (getConnInfo: GetConnInfo) => boot((app) => mountConnInfo(app, getConnInfo))

/** An app like a Bun or custom entry that never calls `mountConnInfo`: no getConnInfo is registered. */
const bootAppWithoutConnInfo = () => boot(() => {})

/** The env of a request from `address`, read by the registered getter, as a Bun-style adapter's would be. */
const from = (address: string) => ({ address })

let app: Hono

/** The warnings are remembered per process: start each test as a fresh process would. */
const forgetWarned = () => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('laratype.http.throttleNoConnInfoWarned')]
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('laratype.http.throttleNoAddressWarned')]
}

/** The contract auth slot @laratype/auth fills: a stand-in factory is removed after its test. */
const forgetContractAuth = () => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('laratype.http.contractAuth')]
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  forgetWarned()
  forgetContractAuth()
  app = bootApp()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  forgetContractAuth()
})

// Each test uses its own addresses: each mount() has its own store (#319)
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

  it('a registered getter that finds no address warns once per process, across routes, and leaves the request unthrottled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // The mounted getter finds no address: a unix socket behind nginx, not a missing adapter
    for (let i = 0; i < 5; i++) expect((await app.request('/api/posts')).status).toBe(200)
    expect((await app.request('/api/posts/1')).status).toBe(200)
    expect(warn).toHaveBeenCalledTimes(1)
    const [message] = warn.mock.calls[0]!
    expect(message).toContain('the registered getConnInfo found no client address')
    expect(message).toContain('a unix socket or named pipe, or a getter for another runtime')
    expect(message).toContain('the limit needs the trusted-proxy setting (#320)')
    expect(message).toContain('first: posts.index')
  })

  it('a registered getter that throws counts the same way', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const throwing = bootAppWith(() => { throw new Error('no socket') })
    for (let i = 0; i < 5; i++) expect((await throwing.request('/api/posts/1')).status).toBe(200)
    expect((await throwing.request('/api/posts')).status).toBe(200)
    expect(warn).toHaveBeenCalledTimes(1)
    const [message] = warn.mock.calls[0]!
    expect(message).toContain('the registered getConnInfo found no client address')
    expect(message).toContain('first: posts.show')
  })

  it('a throttled route with no registered getConnInfo warns only the missing-source warning, once per process', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bare = bootAppWithoutConnInfo()
    for (let i = 0; i < 5; i++) expect((await bare.request('/api/posts')).status).toBe(200)
    expect((await bare.request('/api/posts/1')).status).toBe(200)
    expect(warn).toHaveBeenCalledTimes(1)
    const [message] = warn.mock.calls[0]!
    expect(message).toContain('no getConnInfo is registered, so .throttle() routes serve requests without a limit')
    expect(message).toContain('mountConnInfo(app, getConnInfo from hono/bun or @hono/node-server/conninfo)')
    expect(message).toContain('first: posts.index')
    expect(message).not.toContain('found no client address')
  })

  it('the missing-source and no-address warnings are remembered separately', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bare = bootAppWithoutConnInfo()
    expect((await bare.request('/api/posts')).status).toBe(200)
    // A registered getter that finds no address is a different cause, so it warns too
    expect((await app.request('/api/posts')).status).toBe(200)
    expect(warn).toHaveBeenCalledTimes(2)
    const messages = warn.mock.calls.map(([message]) => message)
    expect(messages[0]).toContain('no getConnInfo is registered')
    expect(messages[1]).toContain('found no client address')
  })

  it('a registered getter with an address does not warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 3; i++) expect((await app.request('/api/posts', {}, from('203.0.113.20'))).status).toBe(200)
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns in production, where the rate limit runs the same', async () => {
    vi.stubGlobal('__PROD__', true)
    vi.stubEnv('NODE_ENV', 'production')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bare = bootAppWithoutConnInfo()
    for (let i = 0; i < 2; i++) expect((await bare.request('/api/posts')).status).toBe(200)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mountConnInfo(app, getConnInfo'))
  })

  it('clients behind a SIIT translator (::ffff:0:a.b.c.d) get their own counter', async () => {
    for (let i = 0; i < 3; i++) await app.request('/api/posts', {}, from('::ffff:0:198.51.100.1'))
    expect((await app.request('/api/posts', {}, from('::ffff:0:198.51.100.1'))).status).toBe(429)
    expect((await app.request('/api/posts', {}, from('::ffff:0:198.51.100.2'))).status).toBe(200)
  })

  it('never reads X-Forwarded-For', async () => {
    await app.request('/api/posts/1', { headers: { 'X-Forwarded-For': '192.0.2.1' } }, from('203.0.113.8'))
    expect((await app.request('/api/posts/1', { headers: { 'X-Forwarded-For': '192.0.2.2' } }, from('203.0.113.8'))).status).toBe(429)
  })

  it('answers 429 without the response kernel too (Hono error handler)', async () => {
    const bare = new Hono()
    mountConnInfo(bare, addressFromEnv)
    routes().mount(bare)
    await bare.request('/api/posts/1', {}, from('203.0.113.9'))
    const limited = await bare.request('/api/posts/1', {}, from('203.0.113.9'))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('10')
    expect(await limited.json()).toEqual({ code: 'TOO_MANY_REQUESTS', message: 'Too Many Requests.' })
  })

  it('answers 429 with the app CORS headers without the response kernel (Hono\'s own cors()) (#319)', async () => {
    const bare = new Hono()
    mountConnInfo(bare, addressFromEnv)
    // Mounted after the capture, as RequestKernel.boot() mounts the app-wide CORS before the routes
    bare.use('*', cors({ origin: 'http://app.test' }))
    routes().mount(bare)
    const headers = { Origin: 'http://app.test' }
    await bare.request('/api/posts/1', { headers }, from('203.0.113.43'))
    const limited = await bare.request('/api/posts/1', { headers }, from('203.0.113.43'))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Access-Control-Allow-Origin')).toBe('http://app.test')
    expect(limited.headers.get('Retry-After')).toBe('10')
  })

  it('each mount has its own counters: two apps do not share a window (#319)', async () => {
    const other = bootApp()
    const address = '203.0.113.42'
    expect((await app.request('/api/posts/1', {}, from(address))).status).toBe(200)
    expect((await app.request('/api/posts/1', {}, from(address))).status).toBe(429)
    // The second app never saw this client: its first request is not limited by the first app's window
    expect((await other.request('/api/posts/1', {}, from(address))).status).toBe(200)
    // And the second app's window did not replace the first app's: it still answers 429
    expect((await app.request('/api/posts/1', {}, from(address))).status).toBe(429)
  })

  it('a .domain() route counts only requests for its host', async () => {
    const onHost = new Hono()
    mountConnInfo(onHost, addressFromEnv)
    routes().domain('api.example.test').mount(onHost)
    onHost.get('/api/posts/:id', (c) => c.text('fallback'))
    expect((await onHost.request('http://other.test/api/posts/1', {}, from('203.0.113.10'))).status).toBe(200)
    expect((await onHost.request('http://api.example.test/api/posts/1', {}, from('203.0.113.10'))).status).toBe(200)
    expect((await onHost.request('http://api.example.test/api/posts/1', {}, from('203.0.113.10'))).status).toBe(429)
    expect(await (await onHost.request('http://other.test/api/posts/1', {}, from('203.0.113.10'))).text()).toBe('fallback')
  })

  it('same-named routes of two domains count separately', async () => {
    const both = new Hono()
    mountConnInfo(both, addressFromEnv)
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

// #319 item 2: the limit stays at mount(), before the contract auth guard (A2 #120) and the body read
describe('the limit runs before the contract auth guard (#319)', () => {
  const guarded = defineContract()({
    index: endpoint.get('/').response(anything).throttle({ limit: 1, per: 60 }),
  }, { auth: true })
  const guardedApi = defineApi({ guarded: { contract: guarded, path: '/guarded', scopes: [] } })
  class GuardedController extends Controller {
    index() { return { ok: true } }
  }
  const guardedRoutes = () => Route.api(guardedApi, (r) => [r.contract(guarded, GuardedController)])

  /** The stand-in factory @laratype/auth fills: a 401 without a bearer token, else the `x-user` id. */
  const registerGuard = (onCall: () => void) => registerContractAuth(() => defineMiddleware<{ user: { id: string } }>(
    (request, next) => {
      onCall()
      if (!request.header('authorization')) throw errors.unauthorized()
      return next({ user: { id: request.header('x-user') ?? '' } })
    },
  ))

  it('answers 429 before the guard runs, and 429 rather than 401 once over the limit', async () => {
    let calls = 0
    registerGuard(() => { calls++ })
    const app = bootRoutes(guardedRoutes())
    const signedIn = { authorization: 'Bearer a', 'x-user': 'a' }
    expect((await app.request('/guarded', { headers: signedIn }, from('203.0.113.40'))).status).toBe(200)
    expect(calls).toBe(1)
    // Over the limit: the guard does not run again, so a flood costs no token check
    expect((await app.request('/guarded', { headers: signedIn }, from('203.0.113.40'))).status).toBe(429)
    expect(calls).toBe(1)
    // No credentials at all: still the 429, not the guard's 401, because the limit comes first
    expect((await app.request('/guarded', {}, from('203.0.113.40'))).status).toBe(429)
    expect(calls).toBe(1)
  })

  it('keys by the address: two users on one address share one budget', async () => {
    registerGuard(() => {})
    const app = bootRoutes(guardedRoutes())
    expect((await app.request('/guarded', { headers: { authorization: 'Bearer a', 'x-user': 'a' } }, from('203.0.113.41'))).status).toBe(200)
    expect((await app.request('/guarded', { headers: { authorization: 'Bearer b', 'x-user': 'b' } }, from('203.0.113.41'))).status).toBe(429)
  })
})

describe('ipBucket', () => {
  it('keys IPv4 as is, IPv4-mapped as IPv4 and IPv6 by its /64', () => {
    expect(ipBucket(undefined)).toBeUndefined()
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

  it('keys the IPv4 address a SIIT or IPv4-compatible form carries, keeping :: and ::1', () => {
    expect(ipBucket('::ffff:0:203.0.113.1')).toBe('203.0.113.1')
    expect(ipBucket('0:0:0:0:ffff:0:cb00:7101')).toBe('203.0.113.1')
    expect(ipBucket('::203.0.113.1')).toBe('203.0.113.1')
    // Two clients behind such a translator never share one bucket
    expect(ipBucket('::ffff:0:1.2.3.4')).not.toBe(ipBucket('::ffff:0:5.6.7.8'))
    expect(ipBucket('::1.2.3.4')).not.toBe(ipBucket('::5.6.7.8'))
    // :: and ::1 embed 0.0.0.0 and 0.0.0.1: they keep their own /64, never an IPv4 client's bucket
    expect(ipBucket('::')).toBe('0:0:0:0::/64')
    expect(ipBucket('::0.0.0.1')).toBe('0:0:0:0::/64')
    expect(ipBucket('::1')).not.toBe(ipBucket('0.0.0.1'))
    expect(ipBucket('::0.0.0.2')).toBe('0.0.0.2')
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
  const windowsOf = (store: MemoryThrottleStore) => (store as unknown as { windows: Map<string, unknown> }).windows

  it('counts hits in fixed windows and drops ended windows', () => {
    const store = new MemoryThrottleStore()
    const start = Date.now()
    expect(store.hit('a', 1000, 'p')).toEqual({ hits: 1, resetAt: start + 1000 })
    expect(store.hit('a', 1000, 'p')).toEqual({ hits: 2, resetAt: start + 1000 })
    vi.advanceTimersByTime(1000)
    expect(store.hit('a', 1000, 'p')).toEqual({ hits: 1, resetAt: start + 2000 })
    const windows = windowsOf(store)
    store.hit('b', 1000, 'p')
    expect(windows.size).toBe(2)
    vi.advanceTimersByTime(60_000)
    store.hit('c', 1000, 'p')
    expect([...windows.keys()]).toEqual(['c'])
  })

  it('when full, drops the ended windows before a live one', () => {
    const store = new MemoryThrottleStore(2)
    store.hit('a', 1000, 'p')
    store.hit('b', 10_000, 'p')
    vi.advanceTimersByTime(1000)
    store.hit('c', 10_000, 'p')
    expect([...windowsOf(store).keys()]).toEqual(['b', 'c'])
  })

  it('when full, drops a newer ended window before an older live one', () => {
    const store = new MemoryThrottleStore(2)
    store.hit('a', 60_000, 'p')
    store.hit('b', 1000, 'p')
    vi.advanceTimersByTime(1000)
    store.hit('c', 60_000, 'p')
    expect([...windowsOf(store).keys()]).toEqual(['a', 'c'])
  })

  it('a full store drops a window that ended between two evictions before a live one, with no full sweep', () => {
    const store = new MemoryThrottleStore(3)
    store.hit('x', 60_000, 'p')
    store.hit('a', 60_000, 'p')
    store.hit('b', 1000, 'p')
    const sweep = vi.spyOn(store as unknown as { sweep(now: number): void }, 'sweep')
    vi.advanceTimersByTime(500)
    store.hit('c', 60_000, 'p')
    vi.advanceTimersByTime(500)
    store.hit('d', 60_000, 'p')
    expect([...windowsOf(store).keys()].sort()).toEqual(['a', 'c', 'd'])
    expect(sweep).not.toHaveBeenCalled()
  })

  it('a full store of live windows drops the one nearest its end', () => {
    const store = new MemoryThrottleStore(2)
    store.hit('long', 60_000, 'p')
    vi.advanceTimersByTime(100)
    store.hit('short', 1000, 'p')
    store.hit('new', 60_000, 'p')
    expect([...windowsOf(store).keys()]).toEqual(['long', 'new'])
  })

  it('keeps at most maxWindows, dropping the window started first', () => {
    const store = new MemoryThrottleStore(2)
    store.hit('a', 10_000, 'p')
    store.hit('b', 10_000, 'p')
    store.hit('a', 10_000, 'p')
    store.hit('c', 10_000, 'p')
    expect([...windowsOf(store).keys()]).toEqual(['b', 'c'])
    expect(store.hit('a', 10_000, 'p').hits).toBe(1)
  })

  it('caps a client prefix, evicting its own window that ends first (#319)', () => {
    const store = new MemoryThrottleStore(10, 2)
    store.hit('a1', 10_000, 'a')
    vi.advanceTimersByTime(100)
    store.hit('a2', 10_000, 'a')
    store.hit('b1', 10_000, 'b')
    vi.advanceTimersByTime(100)
    // `a` is at its cap: the third window drops a1 (the one that ends first), never b1
    store.hit('a3', 10_000, 'a')
    expect([...windowsOf(store).keys()].sort()).toEqual(['a2', 'a3', 'b1'])
  })

  it("a full prefix leaves another prefix's window alone (#319)", () => {
    const store = new MemoryThrottleStore(10, 2)
    store.hit('b1', 60_000, 'b')
    store.hit('b1', 60_000, 'b')
    store.hit('a1', 10_000, 'a')
    store.hit('a2', 10_000, 'a')
    store.hit('a3', 10_000, 'a')
    // b1 kept its two hits: an evicted window would answer 1
    expect(store.hit('b1', 60_000, 'b').hits).toBe(3)
  })

  it('the global cap still bounds many prefixes (#319)', () => {
    const store = new MemoryThrottleStore(2, 10)
    store.hit('k1', 10_000, 'p1')
    store.hit('k2', 10_000, 'p2')
    store.hit('k3', 10_000, 'p3')
    expect([...windowsOf(store).keys()]).toEqual(['k2', 'k3'])
  })

  it("keeps the prefix index when the global eviction drops that prefix's last window (#319)", () => {
    const store = new MemoryThrottleStore(2, 10)
    store.hit('a1', 10_000, 'a')
    store.hit('b1', 20_000, 'b')
    // The store is full: a2's global eviction drops a1, the prefix's only window, and with it the prefix's set
    store.hit('a2', 10_000, 'a')
    const prefixes = (store as unknown as { byPrefix: Map<string, Set<string>> }).byPrefix
    expect([...prefixes.get('a')!]).toEqual(['a2'])
    // a2 is still indexed and droppable: a3's global eviction removes a2 through the prefix index, then a3 is indexed
    store.hit('a3', 10_000, 'a')
    expect([...prefixes.get('a')!]).toEqual(['a3'])
  })
})

describe('clientPrefix', () => {
  it('is the IPv4 address, or the /48 of an IPv6 /64 bucket (#319)', () => {
    expect(clientPrefix('203.0.113.5')).toBe('203.0.113.5')
    expect(clientPrefix('2001:db8:1:2::/64')).toBe('2001:db8:1::/48')
    expect(clientPrefix('0:0:0:0::/64')).toBe('0:0:0::/48')
    // Every bucket ipBucket produces is one of the two forms
    expect(clientPrefix(ipBucket('::1')!)).toBe('0:0:0::/48')
    expect(clientPrefix(ipBucket('::ffff:203.0.113.5')!)).toBe('203.0.113.5')
  })
})

describe('throttled', () => {
  /** A context with the capture a registered getter that found no address leaves on it. */
  const addresslessContext = ({ signal = { aborted: false }, env = {} }: { signal?: unknown, env?: unknown } = {}) => ({
    get: () => ({ registered: true, address: undefined }),
    req: { raw: { signal } },
    env,
  }) as unknown as Context

  const next = (async () => {}) as Next

  /** A context whose registered getter captured `address`. */
  const addressContext = (address: string) => ({
    get: () => ({ registered: true, address }),
    req: { raw: { signal: { aborted: false } } },
    env: {},
  }) as unknown as Context

  const connectionRoute = { name: 'posts.store', method: 'post', path: '/posts', domain: undefined }
  const connectionLimit = { limit: 1, per: 60 }

  it('rejects a window that never ends at mount', () => {
    const route = { name: 'posts.index', method: 'get', path: '/posts', domain: undefined }
    const handle = async () => new Response()
    const store = new MemoryThrottleStore()
    expect(() => throttled(route, { limit: 1, per: 1e300 }, handle, store)).toThrow(
      '[@laratype/http] Route.api: posts.index: throttle per must be from 1 second to 9007199254740991 ms, got 1e+300',
    )
    expect(() => throttled(route, { limit: 1, per: 0.5 }, handle, store)).toThrow(/from 1 second/)
    expect(() => throttled(route, { limit: 1, per: 60 }, handle, store)).not.toThrow()
  })

  it('passes the client prefix of the bucket to the store (#319)', async () => {
    const seen: Array<[string, number, string]> = []
    const store = {
      hit: (key: string, windowMs: number, prefix: string) => {
        seen.push([key, windowMs, prefix])
        return { hits: 1, resetAt: Date.now() + windowMs }
      },
    }
    const middleware = throttled(connectionRoute, connectionLimit, async () => new Response('ok'), store)
    expect(((await middleware(addressContext('2001:db8:1:2::a'), next)) as Response).status).toBe(200)
    expect(((await middleware(addressContext('203.0.113.7'), next)) as Response).status).toBe(200)
    expect(seen).toEqual([
      [expect.stringContaining('2001:db8:1:2::/64'), 60_000, '2001:db8:1::/48'],
      [expect.stringContaining('203.0.113.7'), 60_000, '203.0.113.7'],
    ])
  })

  it("a /48 rotating /64s cannot reset another client's window at the prefix cap (#319)", async () => {
    const store = new MemoryThrottleStore(8, 1)
    const middleware = throttled(connectionRoute, connectionLimit, async () => new Response('ok'), store)
    const client = addressContext('203.0.113.44')
    expect(((await middleware(client, next)) as Response).status).toBe(200)
    await expect(middleware(client, next)).rejects.toMatchObject({ status: 429 })
    // The attacker rotates three /64s of one /48: each new bucket evicts its own prefix's window, not the client's
    for (const ip of ['2001:db8:9:1::1', '2001:db8:9:2::1', '2001:db8:9:3::1']) {
      expect(((await middleware(addressContext(ip), next)) as Response).status).toBe(200)
    }
    await expect(middleware(client, next)).rejects.toMatchObject({ status: 429 })
  })

  it('fails closed without running the handler when the client is gone and no address was read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = vi.fn(async () => new Response('ran'))
    const middleware = throttled(connectionRoute, connectionLimit, handle, new MemoryThrottleStore())

    const aborted = addresslessContext({ signal: { aborted: true } })
    expect(((await middleware(aborted, next)) as Response).status).toBe(204)
    const destroyed = addresslessContext({ env: { incoming: { socket: { destroyed: true } } } })
    expect(((await middleware(destroyed, next)) as Response).status).toBe(204)

    expect(handle).not.toHaveBeenCalled()
    // A reset connection is not a deployment fact: the warning waits for a live request with no address
    expect(warn).not.toHaveBeenCalled()
  })

  it('treats a connection it cannot read as live: the warning, then the handler', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const handle = vi.fn(async () => new Response('ran'))
    const middleware = throttled(connectionRoute, connectionLimit, handle, new MemoryThrottleStore())
    const envs: unknown[] = [
      null, undefined, 'env', 42, [], { incoming: 42 }, { incoming: { socket: 'socket' } }, { incoming: { socket: { destroyed: 'yes' } } },
      { get incoming() { throw new Error('no env') } },
    ]
    for (const env of envs) expect(((await middleware(addresslessContext({ env }), next)) as Response).status).toBe(200)
    // A raw request whose signal read throws is live too
    const throwingSignal = {
      get: () => ({ registered: true, address: undefined }),
      req: { raw: { get signal() { throw new Error('no request') } } },
      env: {},
    } as unknown as Context
    expect(((await middleware(throwingSignal, next)) as Response).status).toBe(200)
    expect(handle).toHaveBeenCalledTimes(envs.length + 1)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('still counts a captured address when the client has gone', async () => {
    const handle = vi.fn(async () => new Response('ran'))
    const middleware = throttled(connectionRoute, connectionLimit, handle, new MemoryThrottleStore())
    const captured = {
      get: () => ({ registered: true, address: '127.0.0.1' }),
      req: { raw: { signal: { aborted: true } } },
      env: {},
    } as unknown as Context
    expect(((await middleware(captured, next)) as Response).status).toBe(200)
    await expect(middleware(captured, next)).rejects.toMatchObject({ status: 429 })
    expect(handle).toHaveBeenCalledTimes(1)
  })
})
