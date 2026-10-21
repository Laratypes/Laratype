// H2a #105: controllers resolved with app.make(), the r.contract() options and ctx.endpoint
// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, __laratype_deps, depsRegistry } from '@laratype/core'
import { ContextApi, HTTP_APP } from '@laratype/support'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Middleware, Request as LaratypeRequest, RequestKernel, Route } from '../../src/index'
import type { ApiRoutes, Ctx } from '../../src/index'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const
const greetings = defineContract()({ index: endpoint.get('/').response(anything), show: endpoint.get('/:id').response(anything) })
const greetingsApi = defineApi({ greetings: { contract: greetings, path: '/api/greetings', scopes: [], dirs: [] } })

class Greeter {
  greet() { return 'hello' }
}
class LoudGreeter extends Greeter {
  greet() { return 'HELLO' }
}

let built = 0
class GreetingController extends Controller {
  constructor(private readonly greeter: Greeter) {
    super()
    built++
  }
  index() { return { message: this.greeter.greet() } }
  show() { return { message: this.greeter.greet() } }
}
// What the sauf DI transform emits for the constructor above
__laratype_deps(GreetingController, [() => Greeter], { params: ['greeter'] })

const greetingRoutes = () => Route.api(greetingsApi, (r) => [r.contract(greetings, GreetingController)])

/** A Hono app booted like `sauf dev` does: the container holds it, and RequestKernel registers its middleware. */
const bootApp = (bind?: (container: Container) => void) => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  bind?.(container)
  new RequestKernel(container).boot()
  return app
}

const json = async (app: Hono, path: string, init?: RequestInit) => (await app.request(path, init)).json()

beforeAll(() => {
  globalThis.__laratype_route_model_bindings = {}
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('controller resolution', () => {
  it('a contract route resolves its controller with constructor DI, a new instance per request', async () => {
    const app = new Hono()
    greetingRoutes().mount(app)
    built = 0
    expect(await json(app, '/api/greetings')).toEqual({ message: 'hello' })
    expect(await json(app, '/api/greetings/1')).toEqual({ message: 'hello' })
    expect(built).toBe(2)
  })

  it('under RequestKernel the controller comes from the app container, so its bindings apply', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const app = bootApp((container) => container.bind(Greeter, LoudGreeter))
    greetingRoutes().mount(app)
    expect(await json(app, '/api/greetings')).toEqual({ message: 'HELLO' })
  })

  it('a bound controller is used as bound', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    class FixedController extends GreetingController {
      index() { return { message: 'fixed' } }
    }
    const app = bootApp((container) => container.bind(GreetingController, () => new FixedController(new Greeter())))
    greetingRoutes().mount(app)
    expect(await json(app, '/api/greetings')).toEqual({ message: 'fixed' })
  })

  it('a 0.5 route resolves its controller with constructor DI too', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const app = bootApp((container) => container.bind(Greeter, LoudGreeter))
    app.get('/legacy', RequestKernel.handle({ method: 'get', path: '/legacy', controller: [GreetingController, 'index'] }))
    expect(await json(app, '/legacy')).toEqual({ message: 'HELLO' })
    // and without RequestKernel, autowired without app bindings
    const bare = new Hono()
    bare.get('/legacy', RequestKernel.handle({ method: 'get', path: '/legacy', controller: [GreetingController, 'index'] }))
    expect(await json(bare, '/legacy')).toEqual({ message: 'hello' })
  })

  it('ContextApi.getContainer() is the app container under RequestKernel; RequestKernel.container() falls back outside it', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const container = new Container({ deps: depsRegistry })
    const app = new Hono()
    container.instance(HTTP_APP, app)
    new RequestKernel(container).boot()
    const seen: unknown[] = []
    class Probe extends Controller {
      index() {
        seen.push(ContextApi.getContainer(), RequestKernel.container())
        return {}
      }
    }
    app.get('/probe', RequestKernel.handle({ method: 'get', path: '/probe', controller: [Probe, 'index'] }))
    await app.request('/probe')
    expect(seen).toEqual([container, container])
    // outside a request, and on a bare app: one autowire-only container, created once
    expect(ContextApi.getContainer()).toBeUndefined()
    const fallback = RequestKernel.container()
    expect(fallback).toBeInstanceOf(Container)
    expect(fallback).not.toBe(container)
    expect(RequestKernel.container()).toBe(fallback)
  })

  it('a dependency the container cannot resolve fails the request, not the mount', async () => {
    class Unknown {}
    class Broken extends Controller {
      constructor(readonly unknown: Unknown) { super() }
      index() { return {} }
      show() { return {} }
    }
    __laratype_deps(Broken, [{ unresolved: 'Unknown', index: 0 }], { params: ['unknown'] })
    const app = new Hono()
    const errors: unknown[] = []
    app.onError((error, c) => {
      errors.push(error)
      return c.text('error', 500)
    })
    Route.api(greetingsApi, (r) => [r.contract(greetings, Broken)]).mount(app)
    expect((await app.request('/api/greetings')).status).toBe(500)
    expect(String(errors[0])).toContain('Cannot resolve Broken constructor param #0 `unknown`')
  })

  it('a controller with constructor params and no DI metadata says how to fix it', async () => {
    class NoMeta extends Controller {
      constructor(readonly greeter: Greeter) { super() }
      index() { return {} }
    }
    const app = new Hono()
    const errors: unknown[] = []
    app.onError((error, c) => {
      errors.push(error)
      return c.text('error', 500)
    })
    app.get('/no-meta', RequestKernel.handle({ method: 'get', path: '/no-meta', controller: [NoMeta, 'index'] }))
    expect((await app.request('/no-meta')).status).toBe(500)
    expect(errors[0]).toMatchObject({
      name: 'DiError',
      message: 'Cannot autowire NoMeta: its constructor takes 1 param(s) but no dependency metadata was found. ' +
        'Fix: compile the controller with the laratype:di plugin (sauf dev / sauf build), or add @Inject(token) to its params or bind it in a service provider `register()`.',
    })
  })
})

describe('ctx.endpoint', () => {
  it('each endpoint of a controller sees its own endpoint, on a per-request object', async () => {
    const seen: Array<Ctx<typeof greetings.index | typeof greetings.show>> = []
    class EndpointController extends Controller {
      index(ctx: Ctx<typeof greetings.index>) {
        seen.push(ctx)
        return { index: ctx.endpoint === greetings.index }
      }
      show(ctx: Ctx<typeof greetings.show>) {
        seen.push(ctx)
        return { show: ctx.endpoint === greetings.show }
      }
    }
    const app = new Hono()
    Route.api(greetingsApi, (r) => [r.contract(greetings, EndpointController)]).mount(app)
    expect(await json(app, '/api/greetings')).toEqual({ index: true })
    expect(await json(app, '/api/greetings/1')).toEqual({ show: true })
    expect(await json(app, '/api/greetings')).toEqual({ index: true })
    expect(seen[0]).not.toBe(seen[2])
    expect(seen[1]!.endpoint).toBe(greetings.show)
  })

  it('is read-only', async () => {
    class Writer extends Controller {
      index(ctx: Ctx<typeof greetings.index>) {
        return {
          set: Reflect.set(ctx, 'endpoint', greetings.show),
          deleted: Reflect.deleteProperty(ctx, 'endpoint'),
          defined: Reflect.defineProperty(ctx, 'endpoint', { value: greetings.show }),
          same: ctx.endpoint === greetings.index,
        }
      }
      show() { return {} }
    }
    const app = new Hono()
    Route.api(greetingsApi, (r) => [r.contract(greetings, Writer)]).mount(app)
    expect(await json(app, '/api/greetings')).toEqual({ set: false, deleted: false, defined: false, same: true })
  })

  it('is not enumerable, so spreading the request does not copy it', async () => {
    class Spread extends Controller {
      index(ctx: Ctx<typeof greetings.index>) { return { copied: 'endpoint' in { ...ctx }, keys: Object.keys(ctx).includes('endpoint') } }
      show() { return {} }
    }
    const app = new Hono()
    Route.api(greetingsApi, (r) => [r.contract(greetings, Spread)]).mount(app)
    expect(await json(app, '/api/greetings')).toEqual({ copied: false, keys: false })
  })

  it('a request class with its own endpoint field is an error, never a writable endpoint', async () => {
    class WithEndpoint extends LaratypeRequest {
      endpoint = 'mine'
    }
    class Handler extends Controller { index() { return {} } }
    const app = new Hono()
    const errors: unknown[] = []
    app.onError((error, c) => {
      errors.push(error)
      return c.text('error', 500)
    })
    app.get('/own', RequestKernel.handle({
      method: 'get', path: '/own', name: 'own', request: WithEndpoint, endpoint: greetings.index, controller: [Handler, 'index'],
    }))
    expect((await app.request('/own')).status).toBe(500)
    expect(String((errors[0] as { getMessage?: () => string }).getMessage?.() ?? errors[0])).toContain(
      'own: the request already has an own "endpoint" property, which ctx.endpoint (#105) reserves: rename that field of WithEndpoint',
    )
  })

  it('a 0.5 route has no endpoint', async () => {
    let endpointOf: unknown = 'unset'
    class Legacy extends Controller {
      index(req: object) {
        endpointOf = (req as { endpoint?: unknown }).endpoint
        return {}
      }
    }
    const app = new Hono()
    app.get('/legacy', RequestKernel.handle({ method: 'get', path: '/legacy', controller: [Legacy, 'index'] }))
    await app.request('/legacy')
    expect(endpointOf).toBeUndefined()
  })
})

describe('r.contract() options', () => {
  const posts = defineContract()({
    index: endpoint.get('/').response(anything),
    destroy: endpoint.delete('/:id').response(anything),
  })
  const postsApi = defineApi({ posts: { contract: posts, path: '/api/posts', scopes: [], dirs: [] } })
  class PostController extends Controller {
    index() { return { index: true } }
    destroy() { return { destroyed: true } }
  }
  class PostPolicy {}

  const hits: string[] = []
  class Audit extends Middleware {
    async handle(request: any, res: Response, next: (request: any) => unknown) {
      hits.push('audit')
      return next(request)
    }
  }
  class Web extends Middleware {
    async handle(request: any, res: Response, next: (request: any) => unknown) {
      hits.push('web')
      return next(request)
    }
  }

  const mount = (routes: ApiRoutes) => {
    const app = new Hono()
    return { app, entries: routes.mount(app) }
  }

  it('endpoints middleware runs for its endpoint only, after the contract middleware', async () => {
    const { app, entries } = mount(Route.api(postsApi, (r) => [
      r.middleware(Web).contract(posts, PostController, { endpoints: { destroy: (r) => r.middleware(Audit, Web) } }),
    ]))
    expect(entries.find((e) => e.name === 'posts.index')!.middleware).toEqual([Web])
    expect(entries.find((e) => e.name === 'posts.destroy')!.middleware).toEqual([Web, Audit])
    hits.length = 0
    expect(await json(app, '/api/posts')).toEqual({ index: true })
    expect(hits).toEqual(['web'])
    hits.length = 0
    expect(await json(app, '/api/posts/1', { method: 'DELETE' })).toEqual({ destroyed: true })
    expect(hits).toEqual(['web', 'audit'])
  })

  it('a tree node takes the same options', () => {
    const { entries } = mount(Route.api(postsApi, (r) => [
      r.contract(postsApi.posts, PostController, { endpoints: { index: (r) => r.middleware(Audit) } }),
    ]))
    expect(entries.find((e) => e.name === 'posts.index')!.middleware).toEqual([Audit])
  })

  it('policy is recorded on every route of the contract, not run', async () => {
    const { app, entries } = mount(Route.api(postsApi, (r) => [r.contract(posts, PostController, { policy: PostPolicy })]))
    expect(entries.map((e) => e.policy)).toEqual([PostPolicy, PostPolicy])
    expect(await json(app, '/api/posts')).toEqual({ index: true })
    const { entries: without } = mount(Route.api(postsApi, (r) => [r.contract(posts, PostController)]))
    expect(without.map((e) => e.policy)).toEqual([undefined, undefined])
  })

  it('an endpoint named after an Object.prototype method takes no inherited callback', () => {
    const odd = defineContract()({ toString: endpoint.get('/').response(anything), index: endpoint.get('/i').response(anything) })
    const oddApi = defineApi({ odd: { contract: odd, path: '/odd', scopes: [], dirs: [] } })
    class Odd extends Controller { toString() { return 'odd' } index() { return {} } }
    const { entries } = mount(Route.api(oddApi, (r) => [r.contract(odd, Odd, { endpoints: { index: (r) => r.middleware(Audit) } })]))
    expect(entries.map((e) => [e.name, e.middleware])).toEqual([['odd.toString', []], ['odd.index', [Audit]]])
  })

  it('an unknown endpoint, a callback that is not one or returns no builder, a policy that is not a class', () => {
    const api = (options: object) => () => Route.api(postsApi, (r) => [r.contract(posts, PostController, options as never)])
    expect(api({ endpoints: { show: (r: any) => r } })).toThrow(
      '[@laratype/http] Route.api: contract "posts": endpoints.show is not an endpoint of the contract (endpoints: "index", "destroy")',
    )
    expect(api({ endpoints: { destroy: Audit.prototype } })).toThrow('contract "posts": endpoints.destroy must be a callback, (r) => r.middleware(...)')
    expect(api({ endpoints: { destroy: () => [Audit] } })).toThrow(
      'posts.destroy: endpoints.destroy must return the builder it gets, (r) => r.middleware(...)',
    )
    expect(api({ policy: 'PostPolicy' })).toThrow('contract "posts": { policy } must be a policy class')
    expect(api({ endpoints: 1 })).toThrow('contract "posts": { endpoints } must map endpoint names to (r) => r.middleware(...)')
  })
})
