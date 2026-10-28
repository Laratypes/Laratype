// H2a #105: controllers resolved with app.make(), the r.contract() options and ctx.endpoint
// The 0.5 response kernel reads controller metadata until H4 #107
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, __laratype_deps, depsRegistry } from '@laratype/core'
import { ContextApi, HTTP_APP } from '@laratype/support'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Middleware, Request as LaratypeRequest, RequestKernel, Route } from '../../src/index'
import type { ApiRoutes, Ctx, EndpointRouteBuilder } from '../../src/index'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const
const greetings = defineContract()({ index: endpoint.get('/').response(anything), show: endpoint.get('/:id').response(anything) })
const greetingsApi = defineApi({ greetings: { contract: greetings, path: '/api/greetings', scopes: [] } })

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

  it('ContextApi.getContainer() is a request scope of the app container under RequestKernel; RequestKernel.container() falls back outside it', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const container = new Container({ deps: depsRegistry })
    const app = new Hono()
    container.instance(HTTP_APP, app)
    new RequestKernel(container).boot()
    const seen: unknown[] = []
    class Probe extends Controller {
      index() {
        seen.push(ContextApi.getContainer(), RequestKernel.container(), RequestKernel.container().make(Greeter))
        return {}
      }
    }
    app.get('/probe', RequestKernel.handle({ method: 'get', path: '/probe', controller: [Probe, 'index'] }))
    container.singleton(Greeter)
    await app.request('/probe')
    const [scope, kernelContainer, greeter] = seen
    expect(kernelContainer).toBe(scope)
    expect(scope).toBeInstanceOf(Container)
    expect(scope).not.toBe(container)
    expect(greeter).toBe(container.make(Greeter))
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
        'Fix: compile the class with the laratype:di plugin (app code under sauf dev), or bind it with a factory in a service provider `register()` of the app container.',
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

  it('middleware reads the endpoint on the request, read-only and non-enumerable', async () => {
    const seen: unknown[] = []
    class Reads extends Middleware {
      async handle(request: any, res: Response, next: (request: any) => unknown) {
        seen.push(request.endpoint, Reflect.set(request, 'endpoint', 'x'), Object.keys(request).includes('endpoint'))
        return next(request)
      }
    }
    class Plain extends Controller { index() { return {} } show() { return {} } }
    const app = new Hono()
    Route.api(greetingsApi, (r) => [r.middleware(Reads).contract(greetings, Plain)]).mount(app)
    await app.request('/api/greetings')
    expect(seen).toEqual([greetings.index, false, false])
  })

  it('a contract route takes no request class: its rules() would be skipped, so registering it throws', () => {
    class StoreRequest extends LaratypeRequest {}
    class Handler extends Controller { index() { return {} } }
    expect(() => RequestKernel.handle({
      method: 'get', path: '/own', name: 'own', request: StoreRequest, endpoint: greetings.index, controller: [Handler, 'index'],
    })).toThrow("own: a contract route validates its endpoint's query and body schemas, so it takes no request class (StoreRequest)")
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
  const postsApi = defineApi({ posts: { contract: posts, path: '/api/posts', scopes: [] } })
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
    const oddApi = defineApi({ odd: { contract: odd, path: '/odd', scopes: [] } })
    class Odd extends Controller { toString() { return 'odd' } index() { return {} } }
    // An object literal also has the inherited toString: the endpoints map types it, and the runtime skips it
    const endpoints = { index: (r: EndpointRouteBuilder) => r.middleware(Audit) }
    const { entries } = mount(Route.api(oddApi, (r) => [r.contract(odd, Odd, { endpoints })]))
    expect(entries.map((e) => [e.name, e.middleware])).toEqual([['odd.toString', []], ['odd.index', [Audit]]])
  })

  it('an endpoint with its own .authorize() needs the contract policy when Route.api mounts', () => {
    const guarded = defineContract()({ index: endpoint.get('/').response(anything), destroy: endpoint.delete('/:id').auth().authorize() })
    const guardedApi = defineApi({ guarded: { contract: guarded, path: '/api/guarded', scopes: [] } })
    class Guarded extends Controller { index() { return {} } destroy() {} }
    const message = '[@laratype/http] Route.api: guarded.destroy: endpoint has .authorize() but r.contract() has no { policy }'
    // the route proof reports the first two at compile time; this is the mount check for untyped callers
    expect(() => Route.api(guardedApi, ((r: any) => [r.contract(guarded, Guarded)]) as never)).toThrow(message)
    expect(() => Route.api(guardedApi, ((r: any) => [r.contract(guarded, Guarded, { policy: undefined })]) as never)).toThrow(message)
    class GuardedPolicy { destroy() { return true } }
    expect(() => Route.api(guardedApi, (r) => [r.contract(guarded, Guarded, { policy: GuardedPolicy })])).not.toThrow()
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

  it('options and endpoints with an inherited key or a prototype that is not plain are an error, naming the key', () => {
    const api = (options: object) => () => Route.api(postsApi, (r) => [r.contract(posts, PostController, options as never)])
    const audited = { destroy: (r: EndpointRouteBuilder) => r.middleware(Audit) }
    // Middleware under an inherited key would be dropped silently: fail open for auth middleware
    expect(api({ endpoints: Object.create(audited) })).toThrow(
      '[@laratype/http] Route.api: contract "posts": endpoints.destroy is inherited: endpoints must have own keys only',
    )
    expect(api(Object.create({ endpoints: audited }))).toThrow('contract "posts": options.endpoints is inherited: options must have own keys only')
    expect(api(Object.create({ policy: PostPolicy }))).toThrow('contract "posts": options.policy is inherited: options must have own keys only')
    class Options { endpoints = audited }
    expect(api(new Options())).toThrow('contract "posts": options must have Object.prototype or null as its prototype, not a class instance or an Object.create(base) object')
    expect(api({ endpoints: Object.create({}) })).toThrow('contract "posts": endpoints must have Object.prototype or null as its prototype, not a class instance or an Object.create(base) object')
    expect(api({ endpoints: [] })).toThrow('contract "posts": endpoints must have Object.prototype or null as its prototype')
    // An enumerable key added to Object.prototype is inherited too
    Object.defineProperty(Object.prototype, 'polluted', { value: 1, enumerable: true, configurable: true, writable: true })
    try {
      expect(api({ endpoints: audited })).toThrow('contract "posts": options.polluted is inherited')
    } finally {
      delete (Object.prototype as { polluted?: unknown }).polluted
    }
    // A null prototype is plain
    const bare = Object.assign(Object.create(null), { endpoints: Object.assign(Object.create(null), audited) })
    expect(mount(api(bare)()).entries.find((e) => e.name === 'posts.destroy')!.middleware).toEqual([Audit])
  })

  it('options and endpoints are copied and frozen at r.contract(): mutating the originals changes nothing', () => {
    const endpoints: Record<string, unknown> = { destroy: (r: EndpointRouteBuilder) => r.middleware(Audit) }
    const options: Record<string, unknown> = { endpoints }
    let mounted: any
    const routes = Route.api(postsApi, (r) => {
      mounted = r.contract(posts, PostController, options as never)
      // after r.contract(), before Route.api checks and builds the routes
      endpoints.destroy = (r: EndpointRouteBuilder) => r.middleware(Web)
      endpoints.index = (r: EndpointRouteBuilder) => r.middleware(Web)
      options.policy = 'not a class'
      return [mounted]
    })
    options.endpoints = { index: (r: EndpointRouteBuilder) => r.middleware(Web) }
    const { entries } = mount(routes)
    expect(entries.map((e) => [e.name, e.middleware, e.policy])).toEqual([['posts.index', [], undefined], ['posts.destroy', [Audit], undefined]])
    expect(mounted.options).not.toBe(options)
    expect(mounted.options.endpoints).not.toBe(endpoints)
    expect(Object.isFrozen(mounted.options) && Object.isFrozen(mounted.options.endpoints)).toBe(true)
    // a null prototype: nothing inherited is read later
    expect(Object.getPrototypeOf(mounted.options)).toBe(null)
  })

  it('a non-enumerable own option key is checked like any other', () => {
    const options = Object.defineProperty({}, 'endpoint', { value: { destroy: (r: EndpointRouteBuilder) => r.middleware(Audit) } })
    expect(() => Route.api(postsApi, (r) => [r.contract(posts, PostController, options as never)])).toThrow(
      'contract "posts": r.contract() options must be { policy?, endpoints? }, not options.endpoint',
    )
  })

  it('a non-enumerable key on Object.prototype is never read as an option', () => {
    class Hidden {}
    Object.defineProperty(Object.prototype, 'policy', { value: Hidden, configurable: true, writable: true })
    try {
      const { entries } = mount(Route.api(postsApi, (r) => [r.contract(posts, PostController, {})]))
      expect(entries.map((e) => e.policy)).toEqual([undefined, undefined])
    } finally {
      delete (Object.prototype as { policy?: unknown }).policy
    }
  })

  it('a prototype chain deeper than one null prototype is not plain, even when nothing in it is enumerable', () => {
    const hidden = Object.create(Object.create(null, { destroy: { value: (r: EndpointRouteBuilder) => r.middleware(Audit) } }))
    expect(() => Route.api(postsApi, (r) => [r.contract(posts, PostController, { endpoints: hidden } as never)])).toThrow(
      'contract "posts": endpoints must have Object.prototype or null as its prototype, not a class instance or an Object.create(base) object',
    )
  })

  it('a null-prototype map with a Symbol.toStringTag (a module namespace) is plain', () => {
    const ns = Object.create(null, { destroy: { value: (r: EndpointRouteBuilder) => r.middleware(Audit), enumerable: true }, [Symbol.toStringTag]: { value: 'Module' } })
    const { entries } = mount(Route.api(postsApi, (r) => [r.contract(posts, PostController, { endpoints: ns })]))
    expect(entries.find((e) => e.name === 'posts.destroy')!.middleware).toEqual([Audit])
  })

  it('r.contract() throws on its own, so a spread of its item or of its options cannot lose the error', () => {
    const endpoints = Object.create({ destroy: (r: EndpointRouteBuilder) => r.middleware(Audit) })
    let reached = false
    const spread = (r: any) => {
      const item = r.contract(posts, PostController, { endpoints })
      reached = true
      return [{ ...item, options: { ...item.options } }]
    }
    expect(() => Route.api(postsApi, spread as never)).toThrow('[@laratype/http] Route.api: contract "posts": endpoints.destroy is inherited')
    expect(reached).toBe(false)
    // r.middleware() keeps the tree, so its r.contract() names the contract too
    expect(() => Route.api(postsApi, ((r: any) => [r.middleware(Audit).contract(posts, PostController, { endpoints })]) as never)).toThrow(
      'contract "posts": endpoints.destroy is inherited',
    )
  })

  it('an item built with no tree entry to name the contract is reported by plan(), which names it', () => {
    // r.contract() cannot name "posts" when its builder has no entry for it, so plan() must report the item: a builder
    // kept from another Route.api() call, or the fresh one an endpoints callback gets, must not hide an inherited key
    const inherited = () => Object.create({ destroy: (r: EndpointRouteBuilder) => r.middleware(Audit) })
    const message = '[@laratype/http] Route.api: contract "posts": endpoints.destroy is inherited: endpoints must have own keys only'
    const other = defineContract()({ index: endpoint.get('/').response(anything) })
    const otherApi = defineApi({ other: { contract: other, path: '/other', scopes: [] } })
    class Other extends Controller {
      index() { return {} }
    }
    let kept: any
    Route.api(otherApi, (r) => {
      kept = r
      return [r.contract(other, Other)]
    })
    const keptItem = kept.contract(posts, PostController, { endpoints: inherited() })
    expect(() => Route.api(postsApi, (() => [keptItem]) as never)).toThrow(message)
    // the issue travels with the frozen options copy: a clone that keeps it still reports, fresh options are re-checked
    expect(() => Route.api(postsApi, (() => [Object.fromEntries(Object.entries(keptItem))]) as never)).toThrow(message)
    expect(() => Route.api(postsApi, (() => [{ ...keptItem, options: { ...keptItem.options } }]) as never)).toThrow(message)
    expect(() => Route.api(postsApi, (() => [{ ...keptItem, options: { endpoints: inherited() } }]) as never)).toThrow(message)
    // a plain copy is checked again, so its marker cannot silence a non-plain prototype
    const plainItem = kept.contract(posts, PostController, {})
    const forged = { ...plainItem, options: Object.assign(Object.create({ destroy: Audit }), plainItem.options) }
    expect(() => Route.api(postsApi, (() => [forged]) as never)).toThrow('contract "posts": options.destroy is inherited')
    // an inherited option key goes through the same deferred check, not only the endpoints map
    const inheritedOption = kept.contract(posts, PostController, Object.create({ policy: PostPolicy }) as never)
    expect(() => Route.api(postsApi, (() => [inheritedOption]) as never)).toThrow('contract "posts": options.policy is inherited')
    let entryless: any
    Route.api(otherApi, (r) => [
      r.contract(other, Other, {
        endpoints: {
          index: (inner) => {
            entryless = (inner as any).contract(posts, PostController, { endpoints: inherited() })
            return inner
          },
        },
      }),
    ])
    expect(() => Route.api(postsApi, (() => [entryless]) as never)).toThrow(message)
    expect(() => Route.api(postsApi, (() => [{ ...entryless }]) as never)).toThrow(message)
  })

  it('a getter is read once: the check and the routes see the same endpoints', () => {
    let reads = 0
    const options = { get endpoints() { return reads++ ? {} : Object.create({ destroy: (r: EndpointRouteBuilder) => r.middleware(Audit) }) } }
    expect(() => Route.api(postsApi, (r) => [r.contract(posts, PostController, options as never)])).toThrow('endpoints.destroy is inherited')
    expect(reads).toBe(1)
  })

  it('an item built without r.contract() is checked and copied too', () => {
    const endpoints = Object.create({ destroy: (r: EndpointRouteBuilder) => r.middleware(Audit) })
    const item = { kind: 'contract', contract: posts, controller: PostController, middleware: [], options: { endpoints } }
    expect(() => Route.api(postsApi, (() => [item]) as never)).toThrow('contract "posts": endpoints.destroy is inherited')
  })

  it('a non-enumerable own callback is copied, checked and applied', () => {
    const endpoints = Object.defineProperty({}, 'destroy', { value: (r: EndpointRouteBuilder) => r.middleware(Audit) })
    const { entries } = mount(Route.api(postsApi, (r) => [r.contract(posts, PostController, { endpoints } as never)]))
    expect(entries.find((e) => e.name === 'posts.destroy')!.middleware).toEqual([Audit])
    const unknown = Object.defineProperty({}, 'show', { value: (r: EndpointRouteBuilder) => r })
    expect(() => Route.api(postsApi, (r) => [r.contract(posts, PostController, { endpoints: unknown } as never)])).toThrow(
      'contract "posts": endpoints.show is not an endpoint of the contract',
    )
  })

  it('an unknown option key is an error', () => {
    const options = { endpoint: { destroy: (r: EndpointRouteBuilder) => r.middleware(Audit) } }
    expect(() => Route.api(postsApi, (r) => [r.contract(posts, PostController, options as never)])).toThrow(
      '[@laratype/http] Route.api: contract "posts": r.contract() options must be { policy?, endpoints? }, not options.endpoint',
    )
  })

  it('a method shorthand named class* is a callback', () => {
    const classy = defineContract()({ classes: endpoint.get('/').response(anything) })
    const classyApi = defineApi({ classy: { contract: classy, path: '/classy', scopes: [] } })
    class Classy extends Controller { classes() { return {} } }
    const { entries } = mount(Route.api(classyApi, (r) => [r.contract(classy, Classy, { endpoints: { classes(r) { return r.middleware(Audit) } } })]))
    expect(entries[0]!.middleware).toEqual([Audit])
    expect(() => Route.api(classyApi, (r) => [r.contract(classy, Classy, { endpoints: { classes(r) { return r } } })])).not.toThrow()
    for (const endpoints of [{ class$(r: EndpointRouteBuilder) { return r } }, { classé(r: EndpointRouteBuilder) { return r } }, { class /* c */ (r: EndpointRouteBuilder) { return r } }]) {
      const [key, callback] = Object.entries(endpoints)[0]!
      const odd = defineContract()({ [key]: endpoint.get('/').response(anything) } as Record<string, ReturnType<typeof endpoint.get>>)
      const oddApi = defineApi({ odd: { contract: odd, path: '/odd', scopes: [] } } as never)
      class Odd extends Controller {}
      Object.defineProperty(Odd.prototype, key, { value: () => ({}) })
      expect(() => Route.api(oddApi as any, ((r: any) => [r.contract(odd, Odd, { endpoints: { [key]: callback } })]) as never)).not.toThrow()
    }
    // a class with a comment after the keyword is still a class
    expect(() => Route.api(classyApi, (r) => [r.contract(classy, Classy, { endpoints: { classes: class/* mw */ Mw {} } as never })])).toThrow(
      'contract "classy": endpoints.classes must be a callback',
    )
  })

  it('a class is not a callback; a callback that throws throws its own error', () => {
    const odd = defineContract()({ hasOwnProperty: endpoint.get('/').response(anything) })
    const oddApi = defineApi({ odd: { contract: odd, path: '/odd', scopes: [] } })
    class Odd extends Controller { hasOwnProperty() { return {} as never } }
    // typed Function there, so the class compiles
    expect(() => Route.api(oddApi, (r) => [r.contract(odd, Odd as never, { endpoints: { hasOwnProperty: Audit } })])).toThrow(
      '[@laratype/http] Route.api: contract "odd": endpoints.hasOwnProperty must be a callback, (r) => r.middleware(...)',
    )
    const broken = () => { throw new Error('audit config missing') }
    expect(() => Route.api(postsApi, (r) => [r.contract(posts, PostController, { endpoints: { destroy: broken } })])).toThrow('audit config missing')
  })

  it('an own "__proto__" key stays a key in the copy', () => {
    const endpoints = JSON.parse('{"__proto__": 1}')
    expect(() => Route.api(postsApi, (r) => [r.contract(posts, PostController, { endpoints } as never)])).toThrow(
      'contract "posts": endpoints.__proto__ is not an endpoint of the contract',
    )
  })
})
