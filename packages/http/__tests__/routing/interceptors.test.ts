// H11 #138: interceptors around the handler (docs/v1/http.md › Interceptors).
// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { z } from 'zod'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { defineApi, defineContract, defineError, defineScope, endpoint } from '@laratype/contract'
import type { ContractPrefix } from '@laratype/contract'
import {
  Controller,
  RequestKernel,
  ResponseKernel,
  Route,
  defineInterceptor,
  defineMiddleware,
  isInterceptor,
} from '../../src/index'
import type { AnyEndpoint, ApiRoutes, Ctx } from '../../src/index'

const PostDto = z.object({ id: z.number(), title: z.string() })
const query = z.object({ q: z.string().min(2).optional() })
const posts = defineContract()({
  index: endpoint.get('/').query(query).response(z.object({ items: z.array(PostDto) })),
  show: endpoint.get('/:post').query(query).response(PostDto),
  destroy: endpoint.delete('/:post').status(204),
})
const appApi = defineApi({ posts: { contract: posts, path: '/api/posts', scopes: [] } })

class Post {
  constructor(readonly id: number, readonly title = 't') {}
}

const postResolver = (raw: string) => (raw === 'missing' ? null : new Post(Number(raw), 'resolved'))

class PostController extends Controller {
  index(ctx: Ctx<typeof posts.index>) { return { items: [{ id: 1, title: ctx.query.q ?? 'all' }] } }
  show(ctx: Ctx<typeof posts.show>) { return { id: Number(ctx.params.post), title: 'lower' } }
  destroy() {}
}

/** An app booted like `sauf dev`: RequestKernel runs the pipeline, ResponseKernel handles errors. */
const bootApp = () => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  return app
}

const mount = (routes: ApiRoutes) => {
  const app = bootApp()
  routes.mount(app)
  return app
}

const json = async (app: Hono, path: string) => (await app.request(path)).json()

const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('defineInterceptor and isInterceptor', () => {
  it('builds a frozen branded value that isInterceptor tells from other values', () => {
    const log = defineInterceptor((_ctx, next) => next())
    expect(isInterceptor(log)).toBe(true)
    expect(Object.isFrozen(log)).toBe(true)
    expect(isInterceptor(undefined)).toBe(false)
    expect(isInterceptor(42)).toBe(false)
    expect(isInterceptor(class {})).toBe(false)
    expect(isInterceptor({ handle: () => undefined })).toBe(false)
    // The brand is the same Symbol.for key H6 uses: a value made by another copy is recognized
    expect(isInterceptor({ [Symbol.for('laratype.http.interceptor')]: true, handle: () => undefined })).toBe(true)
  })

  it('needs a function', () => {
    expect(() => defineInterceptor('nope' as never)).toThrow(
      '[@laratype/http] defineInterceptor(): expected a function (ctx, next), got string',
    )
  })
})

describe('the interceptor chain', () => {
  it('transforms the handler result, and the response schema validates it', async () => {
    let handled = 0
    const upper = defineInterceptor<typeof posts.show>(async (_ctx, next) => {
      const value = await next()
      return { ...value, title: value.title.toUpperCase() }
    })
    class Reads extends Controller {
      index() { return { items: [] } }
      show() { handled++; return { id: 7, title: 'lower' } }
      destroy() {}
    }
    const app = mount(Route.api(appApi, (r) => [r.contract(posts, Reads, { endpoints: { show: (r) => r.interceptor(upper) } })]))
    expect(await json(app, '/api/posts/7')).toEqual({ id: 7, title: 'LOWER' })
    expect(handled).toBe(1)
  })

  it('a cache hit skips the handler, and a cast is the visible opt-in for the value', async () => {
    const store = new Map<string, unknown>()
    let handled = 0
    // The generic form is result-parametric: a cached value is `unknown` until it is cast to R.
    const cache = defineInterceptor(async <R>(ctx: Ctx<AnyEndpoint>, next: () => Promise<R>): Promise<R> => {
      const key = `${ctx.endpoint.def.path}:${ctx.params.post}`
      const hit = store.get(key) as R | undefined
      if (hit !== undefined) return hit
      const value = await next()
      store.set(key, value)
      return value
    })
    class Reads extends Controller {
      index() { return { items: [] } }
      show(ctx: Ctx<typeof posts.show>) { handled++; return { id: Number(ctx.params.post), title: 'cached' } }
      destroy() {}
    }
    const app = mount(Route.api(appApi, (r) => [r.contract(posts, Reads, { endpoints: { show: (r) => r.interceptor(cache) } })]))
    expect(await json(app, '/api/posts/1')).toEqual({ id: 1, title: 'cached' })
    expect(await json(app, '/api/posts/1')).toEqual({ id: 1, title: 'cached' })
    expect(handled).toBe(1)
    expect(await json(app, '/api/posts/2')).toEqual({ id: 2, title: 'cached' })
    expect(handled).toBe(2)
  })

  it('runs after middleware and validation, around the handler, and sees the validated ctx', async () => {
    const trace: string[] = []
    const audit = defineMiddleware<{ user: string }>((_request, next) => {
      trace.push('middleware')
      return next({ user: 'ada' })
    })
    const log = defineInterceptor<typeof posts.show, { user: string }>(async (ctx, next) => {
      trace.push(`before:${ctx.user}:${ctx.query.q}:${ctx.params.post}`)
      const value = await next()
      trace.push(`after:${value.title}`)
      return value
    })
    class Reads extends Controller {
      index() { return { items: [] } }
      show(ctx: Ctx<typeof posts.show>) { trace.push('handler'); return { id: Number(ctx.params.post), title: 'lower' } }
      destroy() {}
    }
    const app = mount(
      Route.api(appApi, (r) => [
        r.middleware(audit).contract(posts, Reads, { endpoints: { show: (r) => r.interceptor(log) } }),
      ]),
    )
    expect(await json(app, '/api/posts/7?q=ok')).toEqual({ id: 7, title: 'lower' })
    expect(trace).toEqual(['middleware', 'before:ada:ok:7', 'handler', 'after:lower'])
  })

  it('validation runs first: a 422 runs no interceptor, and the middleware still ran', async () => {
    const trace: string[] = []
    const audit = defineMiddleware((_request, next) => {
      trace.push('middleware')
      return next()
    })
    const log = defineInterceptor<typeof posts.show>((_ctx, next) => {
      trace.push('interceptor')
      return next()
    })
    class Reads extends Controller {
      index() { return { items: [] } }
      show() { trace.push('handler'); return { id: 1, title: 'x' } }
      destroy() {}
    }
    const app = mount(
      Route.api(appApi, (r) => [
        r.middleware(audit).contract(posts, Reads, { endpoints: { show: (r) => r.interceptor(log) } }),
      ]),
    )
    const res = await app.request('/api/posts/7?q=1')
    expect(res.status).toBe(422)
    expect(trace).toEqual(['middleware'])
  })

  it('a binding miss (404) runs no interceptor; a hit gives the interceptor the bound model', async () => {
    const trace: string[] = []
    const log = defineInterceptor<typeof posts.show, { params: { post: Post } }>((ctx, next) => {
      trace.push(`model:${ctx.params.post.id}`)
      return next()
    })
    class Bound extends Controller {
      index() { return { items: [] } }
      show(ctx: Ctx<typeof posts.show, { params: { post: Post } }>) {
        trace.push('handler')
        return { id: ctx.params.post.id, title: ctx.params.post.title }
      }
      destroy() {}
    }
    const app = mount(
      Route.api(appApi, (r) => [
        r.bind({ post: postResolver }).contract(posts, Bound, { endpoints: { show: (r) => r.interceptor(log) } }),
      ]),
    )
    expect((await app.request('/api/posts/missing')).status).toBe(404)
    expect(trace).toEqual([])
    expect(await json(app, '/api/posts/7')).toEqual({ id: 7, title: 'resolved' })
    expect(trace).toEqual(['model:7', 'handler'])
  })

  it('multiple interceptors run as an onion, and a duplicate runs once at its first position', async () => {
    const trace: string[] = []
    const first = defineInterceptor(async (_ctx, next) => {
      trace.push('first before')
      const value = await next()
      trace.push('first after')
      return value
    })
    const second = defineInterceptor(async (_ctx, next) => {
      trace.push('second before')
      const value = await next()
      trace.push('second after')
      return value
    })
    class Reads extends Controller {
      index() { return { items: [] } }
      show() { trace.push('handler'); return { id: 1, title: 'x' } }
      destroy() {}
    }
    const app = mount(Route.api(appApi, (r) => [r.interceptor(first, second, first).contract(posts, Reads)]))
    expect(await json(app, '/api/posts/1')).toEqual({ id: 1, title: 'x' })
    expect(trace).toEqual(['first before', 'second before', 'handler', 'second after', 'first after'])
  })

  it('runs scope, then contract, then endpoint interceptors, and deduplicates by identity', async () => {
    const trace: string[] = []
    const wrap = (name: string) =>
      defineInterceptor(async (_ctx, next) => {
        trace.push(`${name} before`)
        const value = await next()
        trace.push(`${name} after`)
        return value
      })
    const scopeLog = wrap('scope')
    const contractLog = wrap('contract')
    const endpointLog = wrap('endpoint')
    const scoped = defineScope<ContractPrefix<'/api/users/:user', []>>()({ authorize: false })
    const userPosts = defineContract()({ show: endpoint.get('/:post').response(PostDto) })
    const scopedApi = defineApi({
      'users.posts': { contract: userPosts, path: '/api/users/:user/posts', scopes: [{ scope: scoped, dir: 'users/[user]' }] },
    })
    class Policy {}
    class Reads extends Controller {
      show(ctx: Ctx<typeof userPosts.show>) { trace.push('handler'); return { id: Number(ctx.params.post), title: 'x' } }
    }
    const app = mount(
      Route.api(scopedApi, (r) => {
        const base = r.interceptor(scopeLog)
        return [
          base.scope('users/[user]', { policy: Policy }),
          base.interceptor(scopeLog, contractLog).contract(userPosts, Reads, { endpoints: { show: (r) => r.interceptor(endpointLog) } }),
        ]
      }),
    )
    expect(await json(app, '/api/users/ada/posts/7')).toEqual({ id: 7, title: 'x' })
    expect(trace).toEqual([
      'scope before',
      'contract before',
      'endpoint before',
      'handler',
      'endpoint after',
      'contract after',
      'scope after',
    ])
  })

  it('a bodyless endpoint sends no body, and the interceptor still wraps it', async () => {
    const seen = vi.fn()
    const log = defineInterceptor((_ctx, next) => {
      seen()
      return next()
    })
    const app = mount(Route.api(appApi, (r) => [r.interceptor(log).contract(posts, PostController)]))
    const res = await app.request('/api/posts/7', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(seen).toHaveBeenCalledTimes(1)
  })
})

describe('errors and short-circuits', () => {
  const Conflict = defineError(409, 'CONFLICT', () => ({ message: 'Taken.' }))
  const conflictPosts = defineContract()({ show: endpoint.get('/:post').response(PostDto).throws(Conflict) })
  const conflictApi = defineApi({ posts: { contract: conflictPosts, path: '/api/posts', scopes: [] } })
  class ConflictController extends Controller {
    show() { return { id: 1, title: 'x' } }
  }

  it('a declared contract error thrown by an interceptor answers its status and body', async () => {
    const thrower = defineInterceptor<typeof conflictPosts.show>(() => {
      throw Conflict()
    })
    const app = mount(
      Route.api(conflictApi, (r) => [
        r.contract(conflictPosts, ConflictController, { endpoints: { show: (r) => r.interceptor(thrower) } }),
      ]),
    )
    const res = await app.request('/api/posts/1')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'CONFLICT', message: 'Taken.' })
  })

  it('an undeclared error thrown by an interceptor is the existing logged 500', async () => {
    const error = quiet()
    const boom = defineInterceptor((_ctx, next) => {
      void next
      throw new Error('boom')
    })
    const app = mount(
      Route.api(appApi, (r) => [r.contract(posts, PostController, { endpoints: { show: (r) => r.interceptor(boom) } })]),
    )
    const res = await app.request('/api/posts/1')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ message: 'Server Error' })
    expect(error).toHaveBeenCalled()
  })

  it('a second next() is a TypeError and the handler ran once', async () => {
    const error = quiet()
    let handled = 0
    const twice = defineInterceptor(function twice(_ctx, next) {
      return next().then(() => next())
    })
    class Reads extends Controller {
      index() { return { items: [] } }
      show() { handled++; return { id: 1, title: 'x' } }
      destroy() {}
    }
    const app = mount(
      Route.api(appApi, (r) => [r.contract(posts, Reads, { endpoints: { show: (r) => r.interceptor(twice) } })]),
    )
    const res = await app.request('/api/posts/1')
    expect(res.status).toBe(500)
    expect(handled).toBe(1)
    expect(error.mock.calls.flat().join(' ')).toContain('interceptor twice')
    expect(error.mock.calls.flat().join(' ')).toContain('called next() more than once')
  })

  it('a value that does not match the response schema is the existing dev 500', async () => {
    const error = quiet()
    const broken = defineInterceptor(async <R>(_ctx: Ctx<AnyEndpoint>, next: () => Promise<R>): Promise<R> => {
      await next()
      return { id: 'not a number' } as R
    })
    const app = mount(
      Route.api(appApi, (r) => [r.contract(posts, PostController, { endpoints: { show: (r) => r.interceptor(broken) } })]),
    )
    const res = await app.request('/api/posts/1')
    expect(res.status).toBe(500)
    expect(error.mock.calls.flat().join(' ')).toContain("the handler's value does not match the endpoint's response schema")
  })

  it('r.interceptor() refuses a value that is not a defineInterceptor() value', () => {
    expect(() => Route.api(appApi, (r) => [r.interceptor(42 as never).contract(posts, PostController)])).toThrow(
      '[@laratype/http] Route.api: r.interceptor(): 42 is not an interceptor (a defineInterceptor(...) value)',
    )
  })

  it('a hand-built item is checked at mount: a bad interceptor or a non-array list', () => {
    const item = (interceptors: unknown) =>
      ({ kind: 'contract', contract: posts, controller: PostController, middleware: [], interceptors, bindings: {}, options: undefined }) as never
    expect(() => Route.api(appApi, (() => [item(42)]) as never)).toThrow(
      'interceptors must be an array of defineInterceptor(...) values',
    )
    expect(() => Route.api(appApi, (() => [item([42])]) as never)).toThrow(
      'contract "posts": 42 is not an interceptor (a defineInterceptor(...) value)',
    )
  })

  it('an ad-hoc route after r.interceptor() is a mount error', () => {
    const log = defineInterceptor((_ctx, next) => next())
    expect(() =>
      Route.api(
        appApi,
        ((r) => [
          (r.interceptor(log) as never).get('/health', () => 'ok'),
          r.contract(posts, PostController),
        ]) as never,
      ),
    ).toThrow('r.get(\'/health\'): interceptors need a contract route (there is no endpoint response type to check)')
  })
})

describe('edge inputs', () => {
  const bad = [undefined, null, 42, NaN, Infinity, {}, [], { length: 1e9 }, 'x', 'x'.repeat(10_000) + '\uD800']
  const mountWith = (interceptor: unknown) =>
    Route.api(appApi, (r) => [r.interceptor(interceptor as never).contract(posts, PostController)])

  it.each(bad)('r.interceptor() refuses %s', (value) => {
    expect(() => mountWith(value)).toThrow('is not an interceptor (a defineInterceptor(...) value)')
  })

  it.each(bad)('defineInterceptor() refuses %s as a handler', (value) => {
    expect(() => defineInterceptor(value as never)).toThrow('defineInterceptor(): expected a function (ctx, next)')
  })

  it('a null-prototype object and an own __proto__ key are data, not a brand', () => {
    const nullProto = Object.create(null) as object
    expect(() => mountWith(nullProto)).toThrow('object is not an interceptor')
    const protoKey = JSON.parse('{"__proto__": {"polluted": true}}')
    expect(() => mountWith(protoKey)).toThrow('is not an interceptor')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('a non-enumerable brand with a handle is still a brand, a plain class is not', () => {
    const branded: Record<PropertyKey, unknown> = {}
    Object.defineProperty(branded, Symbol.for('laratype.http.interceptor'), { value: true })
    Object.defineProperty(branded, 'handle', { value: () => undefined })
    expect(isInterceptor(branded)).toBe(true)
    expect(isInterceptor(class Interceptor {})).toBe(false)
  })
})
