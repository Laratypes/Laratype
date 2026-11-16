import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { setConfigs } from '@laratype/core'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
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

  it('fills the full path with buildUrl, encoding a param with "/", "?", "#", "%" and a space', () => {
    mount()
    expect(route('users.posts.show', { user: 7, post: 'a b/c?d#e%f' })).toBe('/api/users/7/posts/a%20b%2Fc%3Fd%23e%25f')
    expect(route('users.posts.index', { user: 'é#%' })).toBe('/api/users/%C3%A9%23%25/posts')
    expect(route('file')).toBe('/files')
    expect(route('file', { name: 'read me' })).toBe('/files/read%20me')
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

  it('rejects an object param that is not a model', () => {
    mount()
    expect(() => route('users.posts.show', { user: {} as never, post: 1 })).toThrow(
      new TypeError('[@laratype/http] route: param "user" got an object that is not a model (no getRouteKey())'),
    )
  })
})

describe('route() absolute URLs', () => {
  it('prefixes config("config.url"), trailing slashes dropped, path prefix kept', () => {
    mount()
    const input = { user: 1, post: 2 }
    expect(route('users.posts.show', input, { absolute: true })).toBe('https://app.test/api/users/1/posts/2')
    expect(route('users.posts.show', input, { absolute: false })).toBe('/api/users/1/posts/2')
    setConfigs({ config: { url: 'https://app.test/sub/' } })
    expect(route('users.posts.show', input, { absolute: true })).toBe('https://app.test/sub/api/users/1/posts/2')
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
    for (const url of ['localhost:3000', '/api', 'ftp://app.test', 'https://app.test/?x=1', 'https://app.test/#h']) {
      setConfigs({ config: { url } })
      const message = `[@laratype/http] route: config('config.url') must be an absolute http(s) URL without a query or hash, got "${url}"`
      expect(() => route('users.posts.show', input, { absolute: true })).toThrow(new TypeError(message))
    }
    setConfigs({ config: { url: '' } })
    expect(() => route('users.posts.show', input, { absolute: true })).toThrow(
      /absolute URLs need config\('config.url'\)/,
    )
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

  it('keeps redirect(url, status) as it was', () => {
    const response = redirect('/login', 301)
    expect(response.getRedirectUrl()).toBe('/login')
    expect(response.getRedirectStatusCode()).toBe(301)
  })
})
