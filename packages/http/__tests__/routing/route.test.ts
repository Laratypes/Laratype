import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { setConfigs } from '@laratype/core'
import { defineApi, defineContract, endpoint, buildUrl } from '@laratype/contract'
import { Model } from '@laratype/database'
import { Controller, Route, redirect, route } from '../../src/index'
import { resetRouteRegistry } from '../../src/routing/routeUrl'

// route() and redirect().route() (H13 #162): names from Route.api(), encoded by buildUrl
const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const
const posts = defineContract()({
  index: endpoint.get('/').query(anything).response(anything),
  show: endpoint.get('/:post').response(anything),
})
const appApi = defineApi({ 'users.posts': { contract: posts, path: '/api/users/:user/posts', scopes: [] } })

// A smaller tree, for the cross-group name checks
const audit = defineContract()({ index: endpoint.get('/') })
const auditApi = defineApi({ 'audit.only': { contract: audit, path: '/api/audit', scopes: [] } })

// The same contract name at another path, for the registry's latest-mount rule
const postsV2 = defineApi({ 'users.posts': { contract: posts, path: '/v2/users/:user/posts', scopes: [] } })

class AuditController extends Controller {
  index() {}
}

class PostController extends Controller {
  index() {
    return {}
  }
  show() {
    return {}
  }
}

/** Mounts the group every test reads names from; a fresh Route.api() call per test. */
const mount = () =>
  Route.api(appApi, (r) => [
    r.contract(posts, PostController),
    r.get('/files/:name?', (req, { name }) => ({ name })).name('file'),
  ])

beforeEach(() => {
  resetRouteRegistry()
  setConfigs({ config: { url: 'https://app.test' } })
})

afterEach(() => {
  setConfigs({})
})

describe('route()', () => {
  it('needs a Route.api() call before it can resolve a name', () => {
    expect(() => route('users.posts.index', { user: 1 })).toThrow(
      new TypeError('[@laratype/http] route: no routes are registered (call Route.api(appApi, ...) first)'),
    )
  })

  it('rejects an unknown name', () => {
    mount()
    expect(() => route('users.posts.nope')).toThrow(
      new TypeError('[@laratype/http] route: unknown route name "users.posts.nope"'),
    )
  })

  it('truncates a long unknown name in the message', () => {
    mount()
    expect(() => route('x'.repeat(100_000))).toThrow(
      new TypeError(`[@laratype/http] route: unknown route name "${'x'.repeat(100)}…"`),
    )
    // characters, not UTF-16 units: an emoji is one character and the cut never splits a surrogate pair
    expect(() => route('😀'.repeat(101))).toThrow(
      new TypeError(`[@laratype/http] route: unknown route name "${'😀'.repeat(100)}…"`),
    )
  })

  it('truncates a 10 MB name from a bounded prefix: Array.from never sees the whole name', () => {
    mount()
    const from = vi.spyOn(Array, 'from')
    let seen: string[] = []
    try {
      // 10 MB of UTF-16 in each direction: BMP units and astral code points (2 units each)
      expect(() => route('x'.repeat(10_000_000))).toThrow(
        new TypeError(`[@laratype/http] route: unknown route name "${'x'.repeat(100)}…"`),
      )
      expect(() => route('😀'.repeat(5_000_000))).toThrow(
        new TypeError(`[@laratype/http] route: unknown route name "${'😀'.repeat(100)}…"`),
      )
    } finally {
      // read the calls before mockRestore clears them
      seen = from.mock.calls.map(([value]) => value).filter((value): value is string => typeof value === 'string')
      from.mockRestore()
    }
    // Array.from got the bounded prefix only (at most 200 UTF-16 units), never the 10 MB name
    expect(seen).toContain('x'.repeat(200))
    expect(seen).toContain('😀'.repeat(100))
    expect(seen.every((value) => value.length <= 200)).toBe(true)
  })

  it('cuts at exactly 100 code points, keeping a whole emoji and never splitting a pair', () => {
    mount()
    // 100 code points: no ellipsis (an astral name is 200 UTF-16 units)
    expect(() => route('a'.repeat(100))).toThrow(
      new TypeError(`[@laratype/http] route: unknown route name "${'a'.repeat(100)}"`),
    )
    expect(() => route('😀'.repeat(100))).toThrow(
      new TypeError(`[@laratype/http] route: unknown route name "${'😀'.repeat(100)}"`),
    )
    // 101 code points: the first 100 plus the ellipsis
    expect(() => route('a'.repeat(101))).toThrow(
      new TypeError(`[@laratype/http] route: unknown route name "${'a'.repeat(100)}…"`),
    )
    // a surrogate pair whose units straddle the 200-unit prefix is dropped whole, never split
    expect(() => route(`${'😀'.repeat(99)}a${'😀'.repeat(2)}`)).toThrow(
      new TypeError(`[@laratype/http] route: unknown route name "${'😀'.repeat(99)}a…"`),
    )
  })

  it('ignores .domain(): the URL is a path, not the host the route is served on', () => {
    mount().domain('api.example.com')
    expect(route('users.posts.show', { user: 1, post: 2 })).toBe('/api/users/1/posts/2')
    expect(route('users.posts.show', { user: 1, post: 2 }, { absolute: true })).toBe(
      'https://app.test/api/users/1/posts/2',
    )
  })

  it('fills the full path with buildUrl, encoding a param with "/", "?", "#", "%" and a space', () => {
    mount()
    expect(route('users.posts.show', { user: 7, post: 'a b/c?d#e%f' })).toBe('/api/users/7/posts/a%20b%2Fc%3Fd%23e%25f')
    expect(route('users.posts.index', { user: 'é#%' })).toBe('/api/users/%C3%A9%23%25/posts')
    expect(route('file')).toBe('/files')
    expect(route('file', { name: 'read me' })).toBe('/files/read%20me')
  })

  it('builds the URL Hono matches for a regex param that holds "/"', async () => {
    const routes = Route.api(appApi, (r) => [
      r.contract(posts, PostController),
      r.get('/files/:file{.+/.+}/raw', (req, { file }) => ({ file })).name('file.raw'),
    ])
    const file = 'a b/c?d#e%f'
    const url = route('file.raw', { file })
    // one encoded segment per part: the "/" stays a separator, so the regex pattern still matches
    expect(url).toBe('/files/a%20b/c%3Fd%23e%25f/raw')
    const app = new Hono()
    routes.mount(app)
    const res = await app.request(url)
    expect(res.status).toBe(200)
    // Hono decodes each segment: the handler reads the value buildUrl was given
    expect(await res.json()).toEqual({ file })
  })

  it('builds a request-derived value its pattern rejects as one encoded segment: a bad id is a 404, not a 500', async () => {
    const routes = Route.api(appApi, (r) => [
      r.contract(posts, PostController),
      r.get('/posts/:id{[0-9]+}', (req, { id }) => ({ id })).name('post.show'),
    ])
    // neither form can match ":id{[0-9]+}" (a "1//2" request value, say): the encoded one is kept and the route 404s
    const url = route('post.show', { id: '1//2' })
    expect(url).toBe('/posts/1%2F%2F2')
    expect(route('post.show', { id: '1/../2' })).toBe('/posts/1%2F..%2F2')
    const app = new Hono()
    routes.mount(app)
    expect((await app.request(url)).status).toBe(404)
  })

  it('refuses a named wildcard route through buildUrl, naming the path', () => {
    Route.api(appApi, (r) => [r.contract(posts, PostController), r.get('/files/*', () => 'ok').name('files.all')])
    expect(() => route('files.all')).toThrow(
      new TypeError('[@laratype/contract] buildUrl: path "/files/*" has a "*" segment, which buildUrl cannot fill'),
    )
  })

  it('serializes the query with buildUrl: "&" and "=" encoded, arrays repeated, null skipped', () => {
    mount()
    const query = { filter: 'a&b=c', tag: ['x', 'y'], none: undefined, nil: null, page: 2 }
    expect(route('users.posts.index', { user: 1 }, { query })).toBe(
      '/api/users/1/posts?filter=a%26b%3Dc&tag=x&tag=y&page=2',
    )
    expect(route('users.posts.index', { user: 1 }, { query: {} })).toBe('/api/users/1/posts')
  })

  it('leaves a missing required param and a bad query to buildUrl', () => {
    mount()
    expect(() => route('users.posts.show', { user: 1 } as never)).toThrow(
      new TypeError('[@laratype/contract] buildUrl: missing param "post" for "/api/users/:user/posts/:post"'),
    )
    expect(() => route('users.posts.index', { user: 1 }, { query: { nested: { a: 1 } } })).toThrow(
      new TypeError(
        '[@laratype/contract] buildUrl: query "nested" must be a string, number, boolean, bigint or Date, or an array of them',
      ),
    )
  })

  it('takes a model param through getRouteKey()', () => {
    class User {
      static readonly primaryKey = 'id'
      static readonly routeKeyName = 'slug'
      constructor(
        readonly id: number,
        readonly slug: string,
      ) {}
      getRouteKey() {
        return this.slug
      }
    }
    mount()
    const user = new User(1, 'ada lovelace')
    expect(route('users.posts.show', { user, post: 2 })).toBe('/api/users/ada%20lovelace/posts/2')
  })

  it('accepts a bigint param, direct and from getRouteKey() (DB1 #145)', () => {
    class BigUser {
      getRouteKey() {
        return 9007199254740993n
      }
    }
    mount()
    // above Number.MAX_SAFE_INTEGER: the value reaches the path as its exact digits
    expect(route('users.posts.show', { user: 9007199254740993n, post: 2 })).toBe('/api/users/9007199254740993/posts/2')
    expect(route('users.posts.show', { user: new BigUser(), post: 2 })).toBe('/api/users/9007199254740993/posts/2')
  })

  it('rejects an object param that is not a model', () => {
    mount()
    expect(() => route('users.posts.show', { user: {} as never, post: 1 })).toThrow(
      new TypeError('[@laratype/http] route: param "user" got an object that is not a model (no getRouteKey())'),
    )
  })

  it('takes a Date or boolean getRouteKey() (H14 #163, the model base returns both)', () => {
    class DatedUser {
      getRouteKey() {
        return new Date('2024-01-02T03:04:05.000Z')
      }
    }
    class FlaggedUser {
      getRouteKey() {
        return true
      }
    }
    mount()
    // ISO 8601 is the form findByRouteKey() converts back (database.md › BindableModel › Key conversion)
    expect(route('users.posts.show', { user: new DatedUser(), post: 2 })).toBe(
      '/api/users/2024-01-02T03%3A04%3A05.000Z/posts/2',
    )
    expect(route('users.posts.show', { user: new FlaggedUser(), post: 2 })).toBe('/api/users/true/posts/2')
  })

  it('refuses a getRouteKey() that is not a route key value', () => {
    class WeirdUser {
      getRouteKey(): unknown {
        return { id: 1 }
      }
    }
    mount()
    expect(() => route('users.posts.show', { user: new WeirdUser() as never, post: 1 })).toThrow(
      new TypeError('[@laratype/http] route: param "user" has a getRouteKey() that is not a string, number, bigint, boolean or Date'),
    )
  })

  it('refuses a getRouteKey() that is an invalid Date, never a RangeError', () => {
    class InvalidDateUser {
      getRouteKey() {
        return new Date(Number.NaN)
      }
    }
    mount()
    expect(() => route('users.posts.show', { user: new InvalidDateUser(), post: 1 })).toThrow(
      new TypeError('[@laratype/http] route: param "user" has a getRouteKey() that returns an invalid Date'),
    )
  })

  it('a real Model instance builds the URL of its route key (issue #163 added task)', () => {
    // DB1's getRouteKey() returns `string | number | bigint | boolean | Date`; route() converts it
    class DbUser extends Model {
      declare readonly id: number
      declare readonly slug: string
    }
    Object.defineProperty(DbUser, 'routeKeyName', { value: 'slug' })
    ;(DbUser as unknown as { getRepository: () => unknown }).getRepository = () => ({
      metadata: {
        targetName: 'DbUser',
        primaryColumns: [{ propertyName: 'id' }],
        columns: [
          { propertyName: 'id', propertyPath: 'id', type: Number },
          { propertyName: 'slug', propertyPath: 'slug', type: String },
        ],
      },
      manager: { connection: { driver: { options: { type: 'mysql' } } } },
    })
    mount()
    const user = Object.assign(new DbUser(), { id: 1, slug: 'ada lovelace' })
    expect(route('users.posts.show', { user, post: 2 })).toBe('/api/users/ada%20lovelace/posts/2')
    // The same URL the key alone builds
    expect(route('users.posts.show', { user: user.getRouteKey(), post: 2 })).toBe(
      route('users.posts.show', { user, post: 2 }),
    )
  })
})

describe('buildUrl through a real Hono app', () => {
  it('keeps "/" one segment, so a value cannot reach a sibling route (C8 #253 B1)', async () => {
    for (const [path, expected] of [
      ['/files/:f{.+}', 'admin/all'],
      ['/files/:f{[^.]+}', 'admin/all'],
    ] as const) {
      const app = new Hono()
      // registered first: a static sibling wins over a param route whenever the raw path matches it
      app.delete('/files/admin/all', () => new Response('sibling'))
      app.delete(path, (c) => c.json({ f: c.req.param('f') }))
      expect(await (await app.request('/files/admin/all', { method: 'DELETE' })).text()).toBe('sibling')
      const url = buildUrl(path, { params: { f: 'admin/all' } })
      // the encoded value stays one segment, so the sibling's path is never spelled out
      expect(url).toBe('/files/admin%2Fall')
      const res = await app.request(url, { method: 'DELETE' })
      expect(res.status).toBe(200)
      // the :f route read the encoded value, and the sibling never ran
      expect(await res.json()).toEqual({ f: expected })
    }
  })

  it('builds a top-level "|" split whole, which a static sibling still shadows (C8 round 3)', async () => {
    const app = new Hono()
    app.delete('/files/admin/all', () => new Response('sibling'))
    app.delete('/files/:f{a|.+/.+}', (c) => c.json({ f: c.req.param('f') }))
    // Hono 4.13.23 groups the alternation in the trie form too (GHSA-586x): the encoded path matches neither
    // alternative, and the split is read whole. The static path is registered first, so it still wins over the param
    expect(await (await app.request('/files/admin/all', { method: 'DELETE' })).text()).toBe('sibling')
    expect((await app.request('/files/admin%2Fall', { method: 'DELETE' })).status).toBe(404)
    expect(await (await app.request('/files/x/y', { method: 'DELETE' })).json()).toEqual({ f: 'x/y' })

    // buildUrl sends the split; without the sibling registration the param route reads it whole
    const url = buildUrl('/files/:f{a|.+/.+}', { params: { f: 'admin/all' } })
    expect(url).toBe('/files/admin/all')
    expect(await (await app.request(url, { method: 'DELETE' })).text()).toBe('sibling')
    const alone = new Hono()
    alone.delete('/files/:f{a|.+/.+}', (c) => c.json({ f: c.req.param('f') }))
    const res = await alone.request(url, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ f: 'admin/all' })
  })

  it('reads a top-level "|" split whole once SmartRouter serves the app with the trie router (C8 round 3)', async () => {
    const app = new Hono()
    app.get('/other/:x{.*}', (c) => c.json({ x: c.req.param('x') }))
    app.get('/files/:f{a|.+/.+}', (c) => c.json({ f: c.req.param('f') }))
    // the ".*" route makes RegExpRouter throw UnsupportedPathError, so SmartRouter serves the whole app with TrieRouter:
    // the encoded value matches neither alternative, and the split is read whole, as buildUrl sends it
    const encoded = await app.request('/files/admin%2Fall')
    expect(encoded.status).toBe(404)
    const split = await app.request('/files/admin/all')
    expect(split.status).toBe(200)
    expect(await split.json()).toEqual({ f: 'admin/all' })
    expect(buildUrl('/files/:f{a|.+/.+}', { params: { f: 'admin/all' } })).toBe('/files/admin/all')
  })

  it('matches the following static segment of a lookahead pattern, so the split reaches the route (C8 round 1)', async () => {
    const routes = Route.api(appApi, (r) => [
      r.contract(posts, PostController),
      r.get('/files/:file{.+/.+(?=/raw)}/raw', (req, { file }) => ({ file })).name('file.lookahead'),
    ])
    const file = 'a/b'
    const url = route('file.lookahead', { file })
    // the pattern's own lookahead needs the following "/raw": Hono's RegExp router refuses it, the trie router serves
    // the route and compiles "^pattern(?=/raw)"
    expect(url).toBe('/files/a/b/raw')
    const app = new Hono()
    routes.mount(app)
    const res = await app.request(url)
    expect(res.status).toBe(200)
    // the handler reads the whole value, not a prefix of it
    expect(await res.json()).toEqual({ file })
  })
})

/** `buildRouteUrl`'s name guard: a TypeError that names only the type of the name, never its value. */
const expectNameTypeError = (call: () => unknown, type: string): void => {
  let error: unknown
  try {
    call()
  } catch (thrown) {
    error = thrown
  }
  // the class too: `toThrow(new TypeError(...))` compares the message only
  expect(error).toBeInstanceOf(TypeError)
  expect((error as Error).message).toBe(`[@laratype/http] route: a route name is a string, got ${type}`)
}

/** Non-string names, as untyped code can pass them: a JSON body value first, then each non-string `typeof`. */
const nonStringNames = [
  ['a { length: 1e9 } object', { length: 1e9 }, 'object'],
  ['an object whose length read throws', { get length() { throw new Error('length read') } }, 'object'],
  ['an object with a non-enumerable length of 1e9', Object.defineProperty({}, 'length', { value: 1e9, enumerable: false }), 'object'],
  ['42', 42, 'number'],
  ['NaN', Number.NaN, 'number'],
  ['Infinity', Number.POSITIVE_INFINITY, 'number'],
  ['null', null, 'object'],
  ['undefined', undefined, 'undefined'],
  ['1n', 1n, 'bigint'],
  ['a symbol', Symbol('name'), 'symbol'],
  ['true', true, 'boolean'],
  ['a function', () => 'name', 'function'],
] as const

describe('route() name guard', () => {
  it('refuses a non-string name without reading its length, so a huge length never reaches Array.from', () => {
    mount()
    let reads = 0
    const value = {
      get length() {
        reads += 1
        return 1e9
      },
    }
    expectNameTypeError(() => route(value as never), 'object')
    // the guard is the first read of the name: a length of 1e9 is never reached
    expect(reads).toBe(0)
  })

  it('refuses a non-string name before it reads the registry at all', () => {
    // no Route.api() call: the name's type wins over "no routes are registered"
    expectNameTypeError(() => route({ length: 1e9 } as never), 'object')
  })

  it.each(nonStringNames)('refuses %s as a name, naming only its type', (_label, value, type) => {
    mount()
    expectNameTypeError(() => route(value as never), type)
  })

  it('names only the type, never the value: an object whose toJSON throws gets the type error', () => {
    mount()
    const value = {
      toJSON() {
        throw new Error('toJSON ran')
      },
    }
    expectNameTypeError(() => route(value as never), 'object')
  })

  it('looks a name up as a plain key, never through the prototype', () => {
    mount()
    for (const name of ['__proto__', 'constructor', 'prototype', 'hasOwnProperty']) {
      expect(() => route(name)).toThrow(
        new TypeError(`[@laratype/http] route: unknown route name ${JSON.stringify(name)}`),
      )
    }
    // a prototype-key name left the registry intact
    expect(route('users.posts.index', { user: 1 })).toBe('/api/users/1/posts')
  })

  it('escapes a control character and a lone surrogate in the echoed name', () => {
    mount()
    expect(() => route('\u0000\u001f')).toThrow(
      new TypeError('[@laratype/http] route: unknown route name "\\u0000\\u001f"'),
    )
    expect(() => route('\ud800')).toThrow(
      new TypeError('[@laratype/http] route: unknown route name "\\ud800"'),
    )
  })

  it('resolves a string name', () => {
    mount()
    expect(route('users.posts.index', { user: 1 })).toBe('/api/users/1/posts')
    // a string still takes the lookup path: unknown, not the type guard
    expect(() => route('users.posts.nope')).toThrow(
      new TypeError('[@laratype/http] route: unknown route name "users.posts.nope"'),
    )
  })
})

describe('route() absolute URLs', () => {
  it('appends the path to config("config.url"), trailing slashes dropped, path prefix kept', () => {
    mount()
    const input = { user: 1, post: 2 }
    expect(route('users.posts.show', input, { absolute: true })).toBe('https://app.test/api/users/1/posts/2')
    expect(route('users.posts.show', input, { absolute: false })).toBe('/api/users/1/posts/2')
    setConfigs({ config: { url: 'https://app.test/sub/' } })
    expect(route('users.posts.show', input, { absolute: true })).toBe('https://app.test/sub/api/users/1/posts/2')
    // a URL value and an empty hash are read as their origin and path
    setConfigs({ config: { url: new URL('https://url-instance.test/sub/#') } })
    expect(route('users.posts.show', input, { absolute: true })).toBe('https://url-instance.test/sub/api/users/1/posts/2')
  })

  it('keeps the config path prefix for every route, the root route "/" included', () => {
    Route.api(appApi, (r) => [r.contract(posts, PostController), r.get('/', () => 'ok').name('root')])
    const cases = [
      // "/sub" and "/sub/" are the same base: the trailing slashes are dropped
      { url: 'https://app.test/sub', root: 'https://app.test/sub/', index: 'https://app.test/sub/api/users/1/posts' },
      { url: 'https://app.test/sub/', root: 'https://app.test/sub/', index: 'https://app.test/sub/api/users/1/posts' },
      { url: 'https://app.test', root: 'https://app.test/', index: 'https://app.test/api/users/1/posts' },
    ]
    for (const { url, root, index } of cases) {
      setConfigs({ config: { url } })
      // the root route keeps the base path, and a query never changes the pathname
      expect(route('root', {}, { absolute: true })).toBe(root)
      expect(route('root', {}, { absolute: true, query: { page: 2 } })).toBe(`${root}?page=2`)
      expect(route('users.posts.index', { user: 1 }, { absolute: true })).toBe(index)
    }
  })

  it('never takes the origin from the request Host or X-Forwarded-Host header', async () => {
    const routes = Route.api(appApi, (r) => [
      r.contract(posts, PostController),
      r.get('/link', () => route('users.posts.show', { user: 1, post: 2 }, { absolute: true })),
    ])
    const app = new Hono()
    routes.mount(app)
    const res = await app.request('http://evil.test/link', {
      headers: { host: 'evil.test', 'x-forwarded-host': 'evil.test' },
    })
    expect(await res.text()).toBe('https://app.test/api/users/1/posts/2')
  })

  it('needs config("config.url"), an absolute http(s) one without a query or hash', () => {
    mount()
    const input = { user: 1, post: 2 }
    setConfigs({})
    expect(() => route('users.posts.show', input, { absolute: true })).toThrow(
      new TypeError("[@laratype/http] route: absolute URLs need config('config.url') (app.url), which is not set"),
    )
    for (const [url, problem] of [
      ['localhost:3000', 'must be an absolute http(s) URL'],
      ['/api', 'must be an absolute http(s) URL'],
      ['ftp://app.test', 'must be an absolute http(s) URL'],
      ['https://app.test/?x=1', 'must not contain a query'],
      ['https://app.test/#h', 'must not contain a hash'],
    ] as const) {
      setConfigs({ config: { url } })
      expect(() => route('users.posts.show', input, { absolute: true })).toThrow(
        new TypeError(`[@laratype/http] route: config('config.url') ${problem}`),
      )
    }
    setConfigs({ config: { url: '' } })
    expect(() => route('users.posts.show', input, { absolute: true })).toThrow(
      /absolute URLs need config\('config.url'\)/,
    )
  })

  it('names the credentials rule without echoing the configured URL', () => {
    mount()
    const input = { user: 1, post: 2 }
    // a URL value carries the same userinfo: neither the string nor the URL is echoed
    for (const url of ['https://alice:hunter2@app.test', 'https://alice:hunter2@app.test/sub/', new URL('https://alice:hunter2@app.test')]) {
      setConfigs({ config: { url } })
      let error: unknown
      try {
        route('users.posts.show', input, { absolute: true })
      } catch (thrown) {
        error = thrown
      }
      expect(error).toBeInstanceOf(TypeError)
      const message = (error as Error).message
      expect(message).toBe("[@laratype/http] route: config('config.url') must not contain credentials")
      // never the URL, nor any part of the userinfo
      expect(message).not.toContain('alice')
      expect(message).not.toContain('hunter2')
    }
  })

  it('treats a config value that is not a string or a URL as not set, never echoing it', () => {
    mount()
    const input = { user: 1, post: 2 }
    const values = [42, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, { length: 1e9 }, {}, Symbol('url'), true, 1n]
    for (const value of values) {
      setConfigs({ config: { url: value as never } })
      expect(() => route('users.posts.show', input, { absolute: true })).toThrow(
        new TypeError("[@laratype/http] route: absolute URLs need config('config.url') (app.url), which is not set"),
      )
    }
  })
})

describe('.name()', () => {
  it('names the route on a new frozen value, which route() reads', () => {
    const routes = Route.api(appApi, (r) => {
      const base = r.get('/health', () => 'ok')
      const named = base.name('health')
      expect(named).not.toBe(base)
      expect(base.routeName).toBeUndefined()
      expect(named.routeName).toBe('health')
      expect(Object.isFrozen(named)).toBe(true)
      return [r.contract(posts, PostController), named]
    })
    expect(routes.adHoc[0]?.name).toBe('health')
    expect(route('health')).toBe('/health')
    expect(mount().adHoc[0]?.name).toBe('file')
  })

  it('needs a non-empty name', () => {
    expect(() =>
      Route.api(appApi, (r) => [r.contract(posts, PostController), r.get('/health', () => 'ok').name('  ')]),
    ).toThrow(new TypeError("[@laratype/http] Route.api: r.get('/health').name() needs a name, a non-empty string"))
  })

  it('rejects a duplicate ad-hoc name in the same group', () => {
    expect(() =>
      Route.api(appApi, (r) => [
        r.contract(posts, PostController),
        r.get('/a', () => 1).name('health'),
        r.get('/b', () => 2).name('health'),
      ]),
    ).toThrow(
      new TypeError('[@laratype/http] Route.api: r.get(\'/b\').name("health") is already the name of r.get(\'/a\')'),
    )
  })

  it('registers no name of a group that a later duplicate fails', () => {
    // a mounted group, so the message of an unregistered name is "unknown", not "no routes are registered"
    Route.api(auditApi, (r) => [r.contract(audit, AuditController)])
    expect(() =>
      Route.api(appApi, (r) => [
        r.contract(posts, PostController),
        r.get('/a', () => 1).name('kept'),
        r.get('/b', () => 2).name('kept'),
      ]),
    ).toThrow(
      new TypeError('[@laratype/http] Route.api: r.get(\'/b\').name("kept") is already the name of r.get(\'/a\')'),
    )
    // the group never mounts, so not even the names before the duplicate are resolvable
    expect(() => route('kept')).toThrow(new TypeError('[@laratype/http] route: unknown route name "kept"'))
    expect(() => route('users.posts.index', { user: 1 })).toThrow(
      new TypeError('[@laratype/http] route: unknown route name "users.posts.index"'),
    )
    expect(route('audit.only.index')).toBe('/api/audit')
  })

  it('registers every name of a group that passes', () => {
    Route.api(appApi, (r) => [r.contract(posts, PostController), r.get('/a', () => 1).name('kept')])
    expect(route('kept')).toBe('/a')
    expect(route('users.posts.index', { user: 1 })).toBe('/api/users/1/posts')
  })

  it('rejects an ad-hoc name a contract route already has', () => {
    expect(() =>
      Route.api(appApi, (r) => [r.contract(posts, PostController), r.get('/x', () => 1).name('users.posts.index')]),
    ).toThrow(
      new TypeError(
        '[@laratype/http] Route.api: r.get(\'/x\').name("users.posts.index") is already the name of users.posts.index',
      ),
    )
  })

  it('merges names across Route.api() calls, and rejects a duplicate across them', () => {
    Route.api(appApi, (r) => [r.contract(posts, PostController), r.get('/a', () => 1).name('health')])
    Route.api(appApi, (r) => [r.contract(posts, PostController), r.get('/b', () => 2).name('status')])
    expect(route('health')).toBe('/a')
    expect(route('status')).toBe('/b')
    expect(route('users.posts.index', { user: 1 })).toBe('/api/users/1/posts')
    const duplicate = () =>
      Route.api(appApi, (r) => [r.contract(posts, PostController), r.get('/c', () => 3).name('health')])
    expect(duplicate).toThrow(
      new TypeError('[@laratype/http] Route.api: r.get(\'/c\').name("health") is already the name of r.get(\'/a\')'),
    )
  })

  it('points a contract name at the path the latest group mounts', () => {
    Route.api(appApi, (r) => [r.contract(posts, PostController)])
    Route.api(postsV2, (r) => [r.contract(posts, PostController)])
    expect(route('users.posts.index', { user: 1 })).toBe('/v2/users/1/posts')
  })

  it('mounts the same group again without a duplicate error (an --hmr restart)', () => {
    const group = () =>
      Route.api(appApi, (r) => [r.contract(posts, PostController), r.get('/health', () => 'ok').name('health')])
    group()
    expect(() => group()).not.toThrow()
    expect(route('health')).toBe('/health')
  })

  it('rejects a contract route whose name an ad-hoc route of an earlier group took', () => {
    expect(() => {
      Route.api(auditApi, (r) => [r.contract(audit, AuditController), r.get('/x', () => 1).name('users.posts.show')])
      Route.api(appApi, (r) => [r.contract(posts, PostController)])
    }).toThrow(new TypeError('[@laratype/http] Route.api: contract "users.posts.show" has the name of r.get(\'/x\')'))
  })
})

describe('redirect().route()', () => {
  it('redirects to the relative URL by default', () => {
    mount()
    const response = redirect().route('users.posts.show', { user: 1, post: 2 })
    expect(response.getRedirectUrl()).toBe('/api/users/1/posts/2')
    expect(response.getRedirectStatusCode()).toBe(302)
  })

  it('takes a status and { absolute: true }', () => {
    mount()
    const response = redirect(301).route('users.posts.show', { user: 1, post: 2 }, { absolute: true })
    expect(response.getRedirectUrl()).toBe('https://app.test/api/users/1/posts/2')
    expect(response.getRedirectStatusCode()).toBe(301)
  })

  it('answers with the Location header through the request pipeline', async () => {
    const routes = Route.api(appApi, (r) => [
      r.contract(posts, PostController),
      r.get('/go', () => redirect().route('users.posts.show', { user: 1, post: 2 })),
    ])
    const app = new Hono()
    routes.mount(app)
    const res = await app.request('/go')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/api/users/1/posts/2')
  })

  it.each(nonStringNames)('refuses %s as a name through the shared guard', (_label, value, type) => {
    mount()
    expectNameTypeError(() => redirect(301).route(value as never), type)
  })

  it('keeps redirect(url, status) as it was', () => {
    const response = redirect('/login', 301)
    expect(response.getRedirectUrl()).toBe('/login')
    expect(response.getRedirectStatusCode()).toBe(301)
  })
})
