// H6 #117: typed middleware with context extension (docs/v1/http.md › Typed middleware)
// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Middleware, Route, defineMiddleware, isTypedMiddleware, response } from '../../src/index'
import type { ApiRoutes, Ctx } from '../../src/index'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const
const posts = defineContract()({ index: endpoint.get('/').response(anything), show: endpoint.get('/:post').response(anything) })
const appApi = defineApi({ posts: { contract: posts, path: '/api/posts', scopes: [] } })

class User {
  constructor(readonly id: number) {}
}

class Plain extends Controller {
  index() { return { ok: true } }
  show(ctx: { params: { post: string } }) { return { post: ctx.params.post } }
}

const mount = (routes: ApiRoutes) => {
  const app = new Hono()
  routes.mount(app)
  return app
}

const json = async (app: Hono, path: string) => (await app.request(path)).json()

beforeAll(() => {
  // RequestKernel.boot() sets this in an app
  globalThis.__laratype_route_model_bindings = {}
})

describe('defineMiddleware', () => {
  it('builds a frozen value that isTypedMiddleware tells from a 0.5 class', () => {
    const audit = defineMiddleware((_request, next) => next())
    expect(isTypedMiddleware(audit)).toBe(true)
    expect(Object.isFrozen(audit)).toBe(true)
    expect(isTypedMiddleware(class extends Middleware {})).toBe(false)
    expect(isTypedMiddleware(undefined)).toBe(false)
    expect(isTypedMiddleware({ handle: () => undefined })).toBe(false)
  })

  it('needs a function', () => {
    expect(() => defineMiddleware('nope' as never)).toThrow('[@laratype/http] defineMiddleware(): expected a function (request, next), got string')
  })

  it('`r.middleware()` rejects a value that is neither a class nor a typed middleware', () => {
    expect(() => Route.api(appApi, (r) => [r.middleware(42 as never).contract(posts, Plain)]))
      .toThrow('[@laratype/http] Route.api: r.middleware(): 42 is not middleware (a 0.5 Middleware class or defineMiddleware(...))')
    // an arrow function is not a 0.5 Middleware class: `new` would throw when the request runs
    expect(() => Route.api(appApi, (r) => [r.middleware(((_request: unknown, next: () => unknown) => next()) as never).contract(posts, Plain)]))
      .toThrow('is not middleware (a 0.5 Middleware class or defineMiddleware(...))')
  })
})

describe('the context extension', () => {
  it('next(ext) adds the keys to the handler ctx, next to its endpoint and params', async () => {
    const user = new User(7)
    const auth = defineMiddleware<{ user: User }>(async (request, next) => {
      // the middleware reads the 0.5 request it gets, before the ctx exists
      expect(request.header('x-test')).toBe('yes')
      return next({ user })
    })
    class Reads extends Controller {
      index(ctx: Ctx<typeof posts.index, { user: User }>) {
        expect(ctx.user).toBe(user)
        expect(Object.keys(ctx).sort()).toEqual(['body', 'params', 'query', 'user'])
        return { id: ctx.user.id }
      }
      show() { return { post: 'x' } }
    }
    const app = mount(Route.api(appApi, (r) => [r.middleware(auth).contract(posts, Reads)]))
    const res = await app.request('/api/posts', { headers: { 'x-test': 'yes' } })
    expect(await res.json()).toEqual({ id: 7 })
  })

  it('ctx.endpoint stays the read-only, non-enumerable own field after the merge', async () => {
    const extra = defineMiddleware((_request, next) => next({ traced: true }))
    class Reads extends Controller {
      index(ctx: Ctx<typeof posts.index, { traced: boolean }>) {
        return {
          traced: ctx.traced,
          path: ctx.endpoint.def.path,
          enumerable: Object.prototype.propertyIsEnumerable.call(ctx, 'endpoint'),
          writable: Object.getOwnPropertyDescriptor(ctx, 'endpoint')!.writable,
        }
      }
      show() { return { post: 'x' } }
    }
    const app = mount(Route.api(appApi, (r) => [r.middleware(extra).contract(posts, Reads)]))
    expect(await json(app, '/api/posts')).toEqual({ traced: true, path: '/', enumerable: false, writable: false })
  })

  it('a later middleware wins a key it also adds', async () => {
    const first = defineMiddleware<{ tag: string }>((_request, next) => next({ tag: 'first' }))
    const second = defineMiddleware<{ tag: string }>((_request, next) => next({ tag: 'second' }))
    class Reads extends Controller {
      index(ctx: Ctx<typeof posts.index, { tag: string }>) { return { tag: ctx.tag } }
      show() { return { post: 'x' } }
    }
    const app = mount(Route.api(appApi, (r) => [r.middleware(first, second).contract(posts, Reads)]))
    expect(await json(app, '/api/posts')).toEqual({ tag: 'second' })
  })

  it('an extension that has params merges them one level deep, the extension winning its key', async () => {
    const withParams = defineMiddleware<{ params: { post: string } }>((request, next) => next({ params: { post: `ext-${request.param('post')}` } }))
    class Reads extends Controller {
      index() { return { ok: true } }
      show(ctx: Ctx<typeof posts.show, { params: { post: string } }>) { return { post: ctx.params.post } }
    }
    const app = mount(Route.api(appApi, (r) => [r.middleware(withParams).contract(posts, Reads)]))
    expect(await json(app, '/api/posts/3')).toEqual({ post: 'ext-3' })
  })

  it('runs with 0.5 middleware in route order and both reach the handler', async () => {
    const calls: string[] = []
    class Legacy extends Middleware {
      async handle(request: unknown, _res: unknown, next: (request: unknown) => Promise<unknown>) {
        calls.push('legacy')
        return next(request)
      }
    }
    const typed = defineMiddleware<{ after: string }>(async (_request, next) => {
      calls.push('typed')
      const result = await next({ after: 'typed' })
      calls.push('typed-after')
      return result
    })
    class Reads extends Controller {
      index(ctx: Ctx<typeof posts.index, { after: string }>) {
        calls.push('handler')
        return { after: ctx.after }
      }
      show() { return { post: 'x' } }
    }
    const app = mount(Route.api(appApi, (r) => [r.middleware(Legacy, typed).contract(posts, Reads)]))
    expect(await json(app, '/api/posts')).toEqual({ after: 'typed' })
    expect(calls).toEqual(['legacy', 'typed', 'handler', 'typed-after'])
  })

  it('can short-circuit: it skips the handler and its value is the response', async () => {
    let handled = 0
    const guard = defineMiddleware(async () => response({ denied: true }, 401))
    class Reads extends Controller {
      index() { handled++; return { ok: true } }
      show() { return { post: 'x' } }
    }
    const app = mount(Route.api(appApi, (r) => [r.middleware(guard).contract(posts, Reads)]))
    const res = await app.request('/api/posts')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ denied: true })
    expect(handled).toBe(0)
  })

  it('next() without an extension adds nothing', async () => {
    const noop = defineMiddleware((_request, next) => next())
    class Reads extends Controller {
      index(ctx: Ctx<typeof posts.index>) { return { keys: Object.keys(ctx).sort() } }
      show() { return { post: 'x' } }
    }
    const app = mount(Route.api(appApi, (r) => [r.middleware(noop).contract(posts, Reads)]))
    expect(await json(app, '/api/posts')).toEqual({ keys: ['body', 'params', 'query'] })
  })

  it('a next(ext) that is not an object fails the request with its middleware named', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = defineMiddleware(function badMiddleware(_request, next) {
      return next('nope' as never)
    })
    const app = mount(Route.api(appApi, (r) => [r.middleware(bad).contract(posts, Plain)]))
    const res = await app.request('/api/posts')
    expect(res.status).toBe(500)
    expect(logged.mock.calls.flat().map(String).join(' ')).toContain(
      '[@laratype/http] typed middleware badMiddleware passed string to next(): pass an object of context keys, or call next()',
    )
  })

  it('extends an ad-hoc route by putting the keys on the 0.5 request it gets', async () => {
    const traced = defineMiddleware<{ traced: true }>((_request, next) => next({ traced: true }))
    const routes = Route.api(appApi, (r) => [
      r.middleware(traced).get('/traced', (request) => ({ traced: (request as unknown as { traced: true }).traced })),
      r.contract(posts, Plain),
    ])
    const app = new Hono()
    routes.mount(app)
    expect(await json(app, '/traced')).toEqual({ traced: true })
  })
})

describe('withoutMiddleware', () => {
  it('drops a middleware the builder accumulated: it does not run and adds no key', async () => {
    let ran = 0
    const traced = defineMiddleware<{ traced: true }>((_request, next) => {
      ran++
      return next({ traced: true })
    })
    class Reads extends Controller {
      index(ctx: Ctx<typeof posts.index>) { return { keys: Object.keys(ctx).sort() } }
      show() { return { post: 'x' } }
    }
    const app = mount(Route.api(appApi, (r) => [r.middleware(traced).withoutMiddleware(traced).contract(posts, Reads)]))
    expect(await json(app, '/api/posts')).toEqual({ keys: ['body', 'params', 'query'] })
    expect(ran).toBe(0)
  })

  it('drops a 0.5 middleware class too, and leaves a same-named one in place', async () => {
    const calls: string[] = []
    class Audit extends Middleware {
      async handle(request: unknown, _res: unknown, next: (request: unknown) => Promise<unknown>) {
        calls.push('audit')
        return next(request)
      }
    }
    class Trace extends Middleware {
      async handle(request: unknown, _res: unknown, next: (request: unknown) => Promise<unknown>) {
        calls.push('trace')
        return next(request)
      }
    }
    class Reads extends Controller {
      index() { return { ok: true } }
      show() { return { post: 'x' } }
    }
    const app = mount(Route.api(appApi, (r) => [r.middleware(Audit, Trace).withoutMiddleware(Audit).contract(posts, Reads)]))
    expect(await json(app, '/api/posts')).toEqual({ ok: true })
    expect(calls).toEqual(['trace'])
  })
})

describe('the registry', () => {
  it('keeps typed middleware in the route entry, in order', () => {
    const auth = defineMiddleware<{ user: User }>((_request, next) => next({ user: new User(1) }))
    class Audit extends Middleware {}
    const routes = Route.api(appApi, (r) => [r.middleware(auth, Audit).contract(posts, Plain)])
    expect(routes.routes[0]!.middleware).toEqual([auth, Audit])
  })

  it('keeps the endpoint callbacks of 0.5 classes after the contract middleware', () => {
    class Audit extends Middleware {}
    class Trace extends Middleware {}
    const routes = Route.api(appApi, (r) => [r.middleware(Trace).contract(posts, Plain, { endpoints: { show: (r) => r.middleware(Audit) } })])
    expect(routes.routes.map((route) => [route.name, route.middleware])).toEqual([
      ['posts.index', [Trace]],
      ['posts.show', [Trace, Audit]],
    ])
  })
})
