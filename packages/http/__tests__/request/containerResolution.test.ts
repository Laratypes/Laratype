// H21 #269: middleware and policies are resolved through the request container, as controllers are (H2a #105)
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, __laratype_deps, depsRegistry } from '@laratype/core'
import { ContextApi, HTTP_APP } from '@laratype/support'
import { AuthManager, Policy, UsePolicy, can } from '@laratype/auth'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, Middleware, RequestKernel, ResponseKernel, Route, defineRouteGroup } from '../../src/index'
import type { PolicyFactory } from '../../src/index'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const
const users = defineContract()({ index: endpoint.get('/').response(anything), show: endpoint.get('/:id').response(anything) })
const usersApi = defineApi({ users: { contract: users, path: '/api/users', scopes: [] } })

/** An app booted like `sauf dev`: RequestKernel runs the pipeline, ResponseKernel handles the errors of a policy. */
const bootApp = (bind?: (container: Container) => void) => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  // `Auth.user()` resolves the default guard of the app container's AuthManager (A4 #151)
  container.instance(AuthManager, new AuthManager({ default: { guard: 'api' }, guards: { api: { provider: Object, verification: 'jwt' } } }))
  bind?.(container)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  return app
}

const json = async (app: Hono, path: string) => (await app.request(path)).json()

const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

beforeAll(() => {
  globalThis.__laratype_route_model_bindings = {}
})

afterEach(() => {
  vi.restoreAllMocks()
  heard.length = 0
  asked.length = 0
})

class Greeter {
  greet() { return 'hello' }
}
class LoudGreeter extends Greeter {
  greet() { return 'HELLO' }
}

/** The middleware of every source: the route's, the contract's and an endpoint's own (`endpoints` map). */
const heard: string[] = []
class Greeting extends Middleware {
  constructor(private readonly greeter: Greeter) { super() }
  async handle(request: any, res: Response, next: (request: any) => unknown) {
    heard.push(`route:${this.greeter.greet()}`)
    return next(request)
  }
}
__laratype_deps(Greeting, [() => Greeter], { params: ['greeter'] })

class Audited extends Middleware {
  constructor(private readonly greeter: Greeter) { super() }
  async handle(request: any, res: Response, next: (request: any) => unknown) {
    heard.push(`endpoint:${this.greeter.greet()}`)
    return next(request)
  }
}
__laratype_deps(Audited, [() => Greeter], { params: ['greeter'] })

class UserController extends Controller {
  index() { return { users: true } }
  show() { return { one: true } }
}

class Legacy extends Controller {
  index() { return { legacy: true } }
}

/** The same middleware class, bound: what the request gets is the binding's class, not the declared one. */
class LoudGreeting extends Greeting {
  override async handle(request: any, res: Response, next: (request: any) => unknown) {
    heard.push(`bound:${this.greeter.greet()}`)
    return next(request)
  }
}

describe('RequestKernel.handle: middleware', () => {
  it('a contract route resolves its route and endpoint middleware with constructor DI, from the app container', async () => {
    quiet()
    const app = bootApp((container) => container.bind(Greeter, LoudGreeter))
    Route.api(usersApi, (r) => [
      r.middleware(Greeting).contract(users, UserController, { endpoints: { show: (r) => r.middleware(Audited) } }),
    ]).mount(app)
    expect(await json(app, '/api/users')).toEqual({ users: true })
    expect(await json(app, '/api/users/1')).toEqual({ one: true })
    expect(heard).toEqual(['route:HELLO', 'route:HELLO', 'endpoint:HELLO'])
    // unbound, autowired without app bindings
    heard.length = 0
    const plain = bootApp()
    Route.api(usersApi, (r) => [
      r.middleware(Greeting).contract(users, UserController, { endpoints: { show: (r) => r.middleware(Audited) } }),
    ]).mount(plain)
    expect(await json(plain, '/api/users/1')).toEqual({ one: true })
    expect(heard).toEqual(['route:hello', 'endpoint:hello'])
  })

  it('a 0.5 route resolves its middleware with constructor DI too', async () => {
    quiet()
    const app = bootApp((container) => container.bind(Greeter, LoudGreeter))
    app.get('/legacy', RequestKernel.handle({ method: 'get', path: '/legacy', controller: [Legacy, 'index'], middleware: [Greeting] }))
    expect(await json(app, '/legacy')).toEqual({ legacy: true })
    expect(heard).toEqual(['route:HELLO'])
  })

  it('a 0.5 group resolves the middleware it merges from its parents with constructor DI', async () => {
    quiet()
    const app = bootApp((container) => container.bind(Greeter, LoudGreeter))
    defineRouteGroup('/api', {
      path: '/',
      middleware: [Greeting],
      children: [{ path: '/legacy', method: 'get', controller: [Legacy, 'index'] }],
    }, { apps: app } as never)
    expect(await json(app, '/api/legacy')).toEqual({ legacy: true })
    expect(heard).toEqual(['route:HELLO'])
  })

  it('a binding of the middleware class itself applies', async () => {
    quiet()
    const app = bootApp((container) => container.bind(Greeting, LoudGreeting))
    Route.api(usersApi, (r) => [r.middleware(Greeting).contract(users, UserController)]).mount(app)
    expect(await json(app, '/api/users')).toEqual({ users: true })
    // The route declares Greeting, the container's binding of that class ran, with its dependency autowired
    expect(heard).toEqual(['bound:hello'])
  })

  it('outside RequestKernel the fallback container autowires it, without app bindings', async () => {
    quiet()
    const bare = new Hono()
    bare.get('/legacy', RequestKernel.handle({ method: 'get', path: '/legacy', controller: [Legacy, 'index'], middleware: [Greeting] }))
    expect(await json(bare, '/legacy')).toEqual({ legacy: true })
    expect(heard).toEqual(['route:hello'])
  })

  it('an unbound middleware is transient: a new instance per request, as with new', async () => {
    quiet()
    let built = 0
    class Counted extends Middleware {
      constructor(private readonly greeter: Greeter) { super(); built++ }
      async handle(request: any, res: Response, next: (request: any) => unknown) {
        return next(request)
      }
    }
    __laratype_deps(Counted, [() => Greeter], { params: ['greeter'] })
    const app = bootApp()
    app.get('/counted', RequestKernel.handle({ method: 'get', path: '/counted', controller: [Legacy, 'index'], middleware: [Counted] }))
    await app.request('/counted')
    await app.request('/counted')
    expect(built).toBe(2)
  })

  it('a middleware with constructor params and no DI metadata fails the request, as a controller does', async () => {
    const errors = quiet()
    class NoMeta extends Middleware {
      constructor(readonly greeter: Greeter) { super() }
      async handle(request: any, res: Response, next: (request: any) => unknown) {
        return next(request)
      }
    }
    const app = bootApp()
    app.get('/no-meta', RequestKernel.handle({ method: 'get', path: '/no-meta', controller: [Legacy, 'index'], middleware: [NoMeta] }))
    const response = await app.request('/no-meta')
    expect(response.status).toBe(500)
    expect(errors.mock.calls.some(([error]) => String(error).includes('Cannot autowire NoMeta'))).toBe(true)
  })
})

/** What the policy consults; a binding of it must reach the policy's constructor. */
const asked: string[] = []
class Permissions {
  allows(ability: string) { asked.push(`base:${ability}`); return true }
}
class DenyAll extends Permissions {
  override allows(ability: string) { asked.push(`deny:${ability}`); return false }
}

class PostPolicy extends Policy {
  constructor(private readonly permissions: Permissions) { super() }
  viewAny() { return true }
  view() { return this.permissions.allows('view') }
  create() { return true }
  update() { return true }
  delete() { return true }
  restore() { return true }
  forceDelete() { return true }
}
__laratype_deps(PostPolicy, [() => Permissions], { params: ['permissions'] })

// The decorator records PostPolicy on the model for the route's can() step, as app code does
@UsePolicy(PostPolicy)
class Post {}

class SignIn extends Middleware {
  async handle(request: any, res: Response, next: (request: any) => unknown) {
    ContextApi.setUser({ id: 1 })
    return next(request)
  }
}

/** A 0.5 route carrying `can('view', Post)`: the policy runs in the pipeline, before the controller. */
const servePosts = (bind?: (container: Container) => void) => {
  const app = bootApp(bind)
  app.get('/posts/:post', RequestKernel.handle({
    method: 'get',
    path: '/posts/:post',
    controller: [UserController, 'show'],
    middleware: [SignIn],
    can: [can('view', Post as never)],
  }))
  return app
}

describe('RequestKernel.handle: policy', () => {
  it('resolves the policy with constructor DI, from the app container', async () => {
    quiet()
    const response = await servePosts((container) => container.bind(Permissions, DenyAll)).request('/posts/1')
    // The bound dependency decided: the policy's own method ran, with what the container injected
    expect(response.status).toBe(401)
    expect(asked).toEqual(['deny:view'])
  })

  it('autowires an unbound policy dependency and lets it allow the request', async () => {
    quiet()
    const response = await servePosts().request('/posts/1')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ one: true })
    expect(asked).toEqual(['base:view'])
  })
})

/** A `can` step that runs without an auth middleware in front: no user, or a custom handler that doesn't allow. */
const reached: string[] = []

class Recorded extends Controller {
  show() { reached.push('show'); return { one: true } }
}

describe('RequestKernel.handle: policy without an authenticated user', () => {
  /** `can` is the only auth step of the route: the middleware list is empty unless the test adds one. */
  const serveGuarded = (can: PolicyFactory[], middleware: Array<typeof Middleware> = []) => {
    const app = bootApp()
    app.get('/guarded/:post', RequestKernel.handle({
      method: 'get',
      path: '/guarded/:post',
      controller: [Recorded, 'show'],
      middleware,
      can,
    }))
    return app
  }

  afterEach(() => {
    reached.length = 0
  })

  it('answers 401 and never runs the controller', async () => {
    quiet()
    const response = await serveGuarded([can('view', Post as never)]).request('/guarded/1')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'UNAUTHORIZED', message: 'You are not authorized to perform this action.' })
    expect(reached).toEqual([])
  })

  it('lets an authenticated user the policy allows reach the controller', async () => {
    quiet()
    const response = await serveGuarded([can('view', Post as never)], [SignIn]).request('/guarded/1')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ one: true })
    expect(reached).toEqual(['show'])
  })

  it('refuses a custom handler that resolves false', async () => {
    quiet()
    const custom = { ability: 'view', args: [], modelPolicy: Post, handle: async () => false }
    const response = await serveGuarded([custom]).request('/guarded/1')
    expect(response.status).toBe(401)
    expect(reached).toEqual([])
  })

  it('refuses a custom handler that resolves undefined', async () => {
    quiet()
    // A factory typed by hand can return no value, whatever `PolicyFactory` declares
    const custom = { ability: 'view', args: [], modelPolicy: Post, handle: async () => undefined } as unknown as PolicyFactory
    const response = await serveGuarded([custom]).request('/guarded/1')
    expect(response.status).toBe(401)
    expect(reached).toEqual([])
  })
})
