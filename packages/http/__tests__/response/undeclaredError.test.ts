// X3 #157: an error a route throws without declaring it on the running endpoint is reported in dev, answers the generic
// 500 in test, and is sent unchanged in production (docs/v1/http.md › Undeclared-error check)
import 'reflect-metadata'
import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP, UnauthorizedException } from '@laratype/support'
import { defineApi, defineContract, defineError, defineScope, endpoint, errors } from '@laratype/contract'
import type { ContractPrefix } from '@laratype/contract'
import { Controller, JsonResource, Middleware, RequestKernel, ResponseKernel, Route } from '../../src/index'
import type { MiddlewareClass } from '../../src/index'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const

const Declared = defineError(409, 'EMAIL_TAKEN', () => ({ message: 'The email is taken.' }))
const AtContract = defineError(402, 'PAYMENT_REQUIRED')
const AtEndpoint = defineError(410, 'GONE')
const Undeclared = defineError(418, 'TEAPOT')
const ServerFailure = defineError(503, 'UNAVAILABLE')
const TokenExpired = defineError(401, 'TOKEN_EXPIRED')
const AtScope = defineError(409, 'SCOPE_TAKEN')

const users = defineContract()({
  show: endpoint.get('/:id').response(anything),                                    // derived 404
  store: endpoint.post('/').body(anything).response(anything, 201),                 // derived 422
  me: endpoint.get('/me').auth().response(anything),                                // derived 401
  guarded: endpoint.get('/guarded').auth().response(anything),                      // a 0.5 Exception, its 401 declared
  open: endpoint.get('/open').response(anything),                                   // a 0.5 Exception, undeclared
  admin: endpoint.get('/admin').auth().authorize().response(anything),              // derived 401, 403
  limited: endpoint.get('/limited').throttle({ limit: 5, per: '1m' }).response(anything),   // derived 429
  paid: endpoint.get('/paid').response(anything),                                   // throws at the contract level
  gone: endpoint.get('/gone').throws(AtEndpoint).response(anything),                // throws at the endpoint
  declared: endpoint.get('/declared').throws(Declared).response(anything),          // a middleware throws it
  undeclared: endpoint.get('/undeclared').response(anything),
  unknown: endpoint.get('/unknown').response(anything),
  failing: endpoint.get('/failing').response(anything),                              // a 0.5 Exception with a 5xx status
  broken: endpoint.get('/broken').response(anything),                                // a 5xx contract error, kept coded
  renamed: endpoint.get('/renamed').auth().response(anything),                       // a 401 UNAUTHORIZED declared, TOKEN_EXPIRED sent
  expired: endpoint.get('/expired').auth().throws(TokenExpired).response(anything),  // both 401s declared
  notModified: endpoint.get('/not-modified').response(anything),                     // a bodyless 304 answer
  noContent: endpoint.get('/no-content').response(anything),                         // a bodyless 204 answer
  resetContent: endpoint.get('/reset-content').response(anything),                   // a bodyless 205 answer
  resource: endpoint.get('/resource').response(anything),                            // a JsonResource whose toJson() throws
  resourceOk: endpoint.get('/resource-ok').response(anything),                       // a JsonResource that resolves
}, { throws: [AtContract] })

const usersApi = defineApi({ users: { contract: users, path: '/api/users', scopes: [] } })

/** A scope that declares a 409 on every route under it: `apiRoutes()` resolves it into each route's errors. */
const rootScope = defineScope()({ throws: [AtScope] })
const scopedContract = defineContract<ContractPrefix<'/api/scoped', [typeof rootScope]>>()({
  index: endpoint.get('/').response(anything),
})
const scopedApi = defineApi({ scoped: { contract: scopedContract, path: '/api/scoped', scopes: [{ scope: rootScope, dir: '' }] } })

/** The error the controller throws last, so a test can check the filter received that very object. */
let thrown: Error

/** A 401 whose body sends another code than `getErrorCode()`: the client narrows by the body's. */
class RenamedException extends UnauthorizedException {
  override getErrorCode(): string { return 'UNAUTHORIZED' }
  override toJson() { return { code: 'TOKEN_EXPIRED', message: this.message } }
}

/** A `JsonResource` whose serialization throws a coded error, as a resource body that fails on a getter would. */
class ThrowingResource extends JsonResource<unknown> {
  override toJson(): unknown { throw (thrown = Undeclared()) }
}

class Users extends Controller {
  show() { throw errors.notFound() }
  store() { throw errors.validation({ name: ['Required'] }) }
  me() { throw errors.unauthorized() }
  guarded() { throw new UnauthorizedException() }
  open() { throw new UnauthorizedException() }
  admin() { throw errors.forbidden() }
  limited() { throw errors.tooManyRequests() }
  paid() { throw (thrown = AtContract()) }
  gone() { throw AtEndpoint() }
  declared() { return {} }
  undeclared() { throw (thrown = Undeclared()) }
  unknown() { throw (thrown = new Error('secret detail')) }
  failing() { throw (thrown = new UnauthorizedException({ httpCode: 503 })) }
  broken() { throw (thrown = ServerFailure()) }
  renamed() { throw (thrown = new RenamedException()) }
  expired() { throw (thrown = new RenamedException()) }
  notModified() { throw (thrown = new UnauthorizedException({ httpCode: 304 })) }
  noContent() { throw (thrown = new UnauthorizedException({ httpCode: 204 })) }
  resetContent() { throw (thrown = new UnauthorizedException({ httpCode: 205 })) }
  resource() { return new ThrowingResource(undefined) }
  resourceOk() { return new JsonResource({ id: 1 }) }
}

/** The controller of the contract under the scope declaring `AtScope`. */
class ScopedUsers extends Controller {
  index() { throw (thrown = AtScope()) }
}

/** A 0.5 route middleware that throws `error()`, not the handler: the check covers it the same way. */
const throwingMiddleware = (error: () => Error): MiddlewareClass => {
  class Throwing extends Middleware {
    async handle() { throw error() }
  }
  return Throwing
}

/** The policy `users.admin`'s `.authorize()` needs at mount: its check is unenforced until A3 #121. */
class AdminPolicy {
  before() { return true }
}

/** An app booted like `sauf dev`: RequestKernel puts the container on each request, ResponseKernel handles errors. */
const bootApp = (middleware: MiddlewareClass[] = []) => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  Route.api(usersApi, (r) => [r.middleware(...middleware).contract(users, Users, { policy: AdminPolicy })]).mount(app)
  return app
}

let logged: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  // the mount warning (auth, authorize and headers validation are not enforced yet) and the throttle's no-IP one
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('__PROD__', false)
  vi.stubEnv('NODE_ENV', 'development')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const undeclaredLine = (route: string, status: number, code: string) =>
  `[@laratype/http] ${route}: the route threw ${status} ${code}, which the endpoint does not declare: ` +
  'add it with .throws(...) on the endpoint, or throws: [...] on its contract or a scope'

describe('declared errors', () => {
  it.each([
    ['the derived 404 (a path param)', '/api/users/1', { method: 'GET' }, 404, 'NOT_FOUND'],
    ['the derived 422 (a body schema)', '/api/users', { method: 'POST' }, 422, 'VALIDATION_ERROR'],
    ['the derived 401 (auth)', '/api/users/me', { method: 'GET' }, 401, 'UNAUTHORIZED'],
    ['the derived 403 (authorize)', '/api/users/admin', { method: 'GET' }, 403, 'FORBIDDEN'],
    ['the derived 429 (throttle)', '/api/users/limited', { method: 'GET' }, 429, 'TOO_MANY_REQUESTS'],
    ['a throws of the contract', '/api/users/paid', { method: 'GET' }, 402, 'PAYMENT_REQUIRED'],
    ['a throws of the endpoint', '/api/users/gone', { method: 'GET' }, 410, 'GONE'],
  ] as const)('%s passes silently', async (_, path, init, status, code) => {
    const response = await bootApp().request(path, init)
    expect(response.status).toBe(status)
    expect((await response.json()).code).toBe(code)
    expect(logged).not.toHaveBeenCalled()
  })

  it('a declared error thrown by a route middleware passes silently', async () => {
    const response = await bootApp([throwingMiddleware(() => Declared())]).request('/api/users/declared')
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('EMAIL_TAKEN')
    expect(logged).not.toHaveBeenCalled()
  })

  it('a test run does not turn a declared error into the generic 500', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const response = await bootApp().request('/api/users/1')
    expect(response.status).toBe(404)
    expect(logged).not.toHaveBeenCalled()
  })

  it('a responsible 0.5 Exception whose code and status are declared passes silently', async () => {
    const response = await bootApp().request('/api/users/guarded')
    expect(response.status).toBe(401)
    expect((await response.json()).code).toBe('UNAUTHORIZED')
    expect(logged).not.toHaveBeenCalled()
  })

  it('a throws declared only by a scope passes silently', async () => {
    // `apiRoutes()` resolves the scope chain into the route's errors, and the 409 below is declared there only
    const container = new Container({ deps: depsRegistry })
    const app = new Hono()
    container.instance(HTTP_APP, app)
    new RequestKernel(container).boot()
    new ResponseKernel(container).boot()
    Route.api(scopedApi, (r) => [r.contract(scopedContract, ScopedUsers)]).mount(app)
    const response = await app.request('/api/scoped')
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'SCOPE_TAKEN', message: 'SCOPE_TAKEN' })
    expect(logged).not.toHaveBeenCalled()
  })
})

describe('an undeclared contract error', () => {
  it('is reported in dev, with the thrown error, and keeps its own status', async () => {
    const response = await bootApp().request('/api/users/undeclared')
    expect(response.status).toBe(418)
    expect(await response.json()).toEqual({ code: 'TEAPOT', message: 'TEAPOT' })
    expect(logged).toHaveBeenCalledTimes(1)
    expect(logged).toHaveBeenCalledWith(undeclaredLine('users.undeclared', 418, 'TEAPOT'), thrown)
  })

  it('sends the original error to the exception filter unchanged in dev', async () => {
    // Spied before boot(), so the handler Hono registers is the spy: it sees what the filter receives
    const received = vi.spyOn(ResponseKernel.prototype, 'resolveException')
    const response = await bootApp().request('/api/users/undeclared')
    expect(response.status).toBe(418)
    expect(received).toHaveBeenCalledTimes(1)
    expect(received.mock.calls[0]![0]).toBe(thrown)
  })

  it('answers the generic 500 and is logged in test, with the original error as its cause', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const received = vi.spyOn(ResponseKernel.prototype, 'resolveException')
    const response = await bootApp().request('/api/users/undeclared')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ message: 'Server Error' })
    // one log, by the exception filter's 5xx path: the diagnostic, whose cause is the contract error
    expect(logged).toHaveBeenCalledTimes(1)
    const diagnostic = logged.mock.calls[0]![0] as Error
    expect(diagnostic.message).toBe(undeclaredLine('users.undeclared', 418, 'TEAPOT'))
    expect(diagnostic.cause).toBe(thrown)
    expect(received.mock.calls[0]![0]).toBe(diagnostic)
  })

  it('a 5xx contract error keeps its code: it is checked like any other contract error', async () => {
    const dev = await bootApp().request('/api/users/broken')
    expect(dev.status).toBe(503)
    expect(await dev.json()).toEqual({ code: 'UNAVAILABLE', message: 'UNAVAILABLE' })
    expect(logged).toHaveBeenCalledWith(undeclaredLine('users.broken', 503, 'UNAVAILABLE'), thrown)

    logged.mockClear()
    vi.stubEnv('NODE_ENV', 'test')
    const test = await bootApp().request('/api/users/broken')
    expect(test.status).toBe(500)                                    // the test wrapper, as for any undeclared error
    expect((logged.mock.calls[0]![0] as Error).message).toBe(undeclaredLine('users.broken', 503, 'UNAVAILABLE'))
  })

  it('is reported in dev when a route middleware throws it, not the handler', async () => {
    const failure = Undeclared()
    const response = await bootApp([throwingMiddleware(() => failure)]).request('/api/users/declared')
    expect(response.status).toBe(418)
    expect(logged).toHaveBeenCalledWith(undeclaredLine('users.declared', 418, 'TEAPOT'), failure)
  })

  it('fails a test when a route middleware throws it', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const response = await bootApp([throwingMiddleware(() => Undeclared())]).request('/api/users/declared')
    expect(response.status).toBe(500)
    expect(logged).toHaveBeenCalledTimes(1)
    expect((logged.mock.calls[0]![0] as Error).message).toBe(undeclaredLine('users.declared', 418, 'TEAPOT'))
  })

  it('is sent unchanged in production, with no report', async () => {
    vi.stubGlobal('__PROD__', true)
    const response = await bootApp().request('/api/users/undeclared')
    expect(response.status).toBe(418)
    expect(await response.json()).toEqual({ code: 'TEAPOT', message: 'TEAPOT' })
    expect(logged).not.toHaveBeenCalled()
  })

  it('is skipped without __PROD__ when NODE_ENV is production', async () => {
    vi.stubGlobal('__PROD__', undefined)
    vi.stubEnv('NODE_ENV', 'production')
    const response = await bootApp().request('/api/users/undeclared')
    expect(response.status).toBe(418)
    expect(logged).not.toHaveBeenCalled()
  })

  it('is reported when __PROD__ is explicitly false, whatever NODE_ENV says', async () => {
    vi.stubGlobal('__PROD__', false)
    vi.stubEnv('NODE_ENV', 'production')
    const response = await bootApp().request('/api/users/undeclared')
    expect(response.status).toBe(418)
    expect(logged).toHaveBeenCalledWith(undeclaredLine('users.undeclared', 418, 'TEAPOT'), thrown)
  })

  it('is reported for a responsible 0.5 Exception: its code reaches the client too', async () => {
    const response = await bootApp().request('/api/users/open')
    expect(response.status).toBe(401)
    expect(logged).toHaveBeenCalledWith(
      undeclaredLine('users.open', 401, 'UNAUTHORIZED'),
      expect.any(UnauthorizedException),
    )
  })
})

describe('the code the exception filter sends', () => {
  it('is the one toJson() sends, not getErrorCode()', async () => {
    const response = await bootApp().request('/api/users/renamed')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      code: 'TOKEN_EXPIRED',
      message: 'You are not authorized to perform this action.',
    })
    expect(logged).toHaveBeenCalledWith(undeclaredLine('users.renamed', 401, 'TOKEN_EXPIRED'), thrown)
    // UNAUTHORIZED is what getErrorCode() says, and .auth() declares it: reading it would have passed silently
    expect(String(logged.mock.calls[0]![0])).not.toContain('UNAUTHORIZED')
  })

  it('a body code the endpoint declares passes silently', async () => {
    const response = await bootApp().request('/api/users/expired')
    expect(response.status).toBe(401)
    expect((await response.json()).code).toBe('TOKEN_EXPIRED')
    expect(logged).not.toHaveBeenCalled()
  })

  it('fails a test with the body code', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const response = await bootApp().request('/api/users/renamed')
    expect(response.status).toBe(500)
    expect((logged.mock.calls[0]![0] as Error).message).toBe(undeclaredLine('users.renamed', 401, 'TOKEN_EXPIRED'))
  })

  it('a code getter on the body is read, as serialization reads it', async () => {
    class Getter extends UnauthorizedException {
      override toJson() {
        return { get code() { return 'TEAPOT' }, message: 'from a getter' }
      }
    }
    const failure = new Getter()
    const response = await bootApp([throwingMiddleware(() => failure)]).request('/api/users/declared')
    expect(response.status).toBe(401)
    expect(logged).toHaveBeenCalledWith(undeclaredLine('users.declared', 401, 'TEAPOT'), failure)
  })

  it.each([
    ['a null body', null],
    ['a string body', 'TEAPOT'],
    ['a numeric code', { code: 418 }],
    ['an empty code', { code: '' }],
    ['no code', { message: 'TEAPOT' }],
    ['a non-enumerable code', Object.defineProperty({ message: 'TEAPOT' }, 'code', { value: 'TEAPOT' })],
    ['an inherited code', Object.assign(Object.create({ code: 'TEAPOT' }), { message: 'TEAPOT' })],
    ['a "__proto__" key', JSON.parse('{"__proto__":{"code":"TEAPOT"},"message":"TEAPOT"}')],
  ] as const)('%s carries no code the client can narrow: not checked', async (_, payload) => {
    class Odd extends UnauthorizedException {
      override toJson(): any { return payload }
    }
    const response = await bootApp([throwingMiddleware(() => new Odd())]).request('/api/users/declared')
    expect(response.status).toBe(401)
    expect(logged).not.toHaveBeenCalled()
  })

  it('a very long code is reported as one line', async () => {
    const code = `X${'A'.repeat(10_000)}`
    class Long extends UnauthorizedException {
      override toJson() { return { code, message: 'long' } }
    }
    const failure = new Long()
    const response = await bootApp([throwingMiddleware(() => failure)]).request('/api/users/declared')
    expect(response.status).toBe(401)
    expect(logged).toHaveBeenCalledWith(undeclaredLine('users.declared', 401, code), failure)
  })

  it('a code with a lone surrogate and a control character is reported unchanged', async () => {
    // The code is the app's, not the client's input: the line carries it as it is, and a lone surrogate must not throw
    const code = 'TEAPOT\uD800\u0007'
    class Unicode extends UnauthorizedException {
      override toJson() { return { code, message: 'unicode' } }
    }
    const failure = new Unicode()
    const response = await bootApp([throwingMiddleware(() => failure)]).request('/api/users/declared')
    expect(response.status).toBe(401)
    expect(logged).toHaveBeenCalledWith(undeclaredLine('users.declared', 401, code), failure)
  })
})

describe('an answer with no body', () => {
  it.each([
    ['a 204', '/api/users/no-content', 204],
    ['a 205', '/api/users/reset-content', 205],
    ['a 304', '/api/users/not-modified', 304],
  ] as const)('%s responsible Exception carries no code: not checked, in dev and in test', async (_, path, status) => {
    const app = bootApp()
    const dev = await app.request(path)
    expect(dev.status).toBe(status)
    expect(await dev.text()).toBe('')

    vi.stubEnv('NODE_ENV', 'test')
    const test = await app.request(path)
    expect(test.status).toBe(status)                                 // not the test wrapper's generic 500
    expect(await test.text()).toBe('')
    expect(logged).not.toHaveBeenCalled()
  })
})

describe('the contract response resolution', () => {
  it('a JsonResource whose toJson() throws is reported in dev, and a successful one keeps its body', async () => {
    const app = bootApp()
    const ok = await app.request('/api/users/resource-ok')
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ id: 1 })
    expect(logged).not.toHaveBeenCalled()

    const response = await app.request('/api/users/resource')
    expect(response.status).toBe(418)                                // the filter answers the coded error it threw
    expect(await response.json()).toEqual({ code: 'TEAPOT', message: 'TEAPOT' })
    expect(logged).toHaveBeenCalledWith(undeclaredLine('users.resource', 418, 'TEAPOT'), thrown)
  })

  it('a JsonResource whose toJson() throws fails the test with the generic 500', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const response = await bootApp().request('/api/users/resource')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ message: 'Server Error' })
    const diagnostic = logged.mock.calls[0]![0] as Error
    expect(diagnostic.message).toBe(undeclaredLine('users.resource', 418, 'TEAPOT'))
    expect(diagnostic.cause).toBe(thrown)
  })
})

describe('what is not checked', () => {
  it.each([
    ['an object', { length: 1e9 }],
    ['a number', 418],
    ['null', null],
    ['undefined', undefined],
    ['a lone surrogate string', '\uD800'],
  ])('%s thrown is no exported error: not checked, in dev and in test', async (_, value) => {
    class Raw extends Controller { index() { throw value } }
    const container = new Container({ deps: depsRegistry })
    const app = new Hono()
    container.instance(HTTP_APP, app)
    new RequestKernel(container).boot()
    new ResponseKernel(container).boot()
    // An empty resolved set still runs the check: the thrown value is what it must classify, and it has no code
    app.get('/raw-throw', RequestKernel.handle({
      method: 'get', path: '/raw-throw', errors: [], controller: [Raw, 'index'],
    }))

    const dev = await app.request('/raw-throw')
    expect(dev.status).toBe(500)
    expect(await dev.json()).toEqual({ message: 'Server Error' })

    vi.stubEnv('NODE_ENV', 'test')
    const test = await app.request('/raw-throw')
    expect(test.status).toBe(500)
    expect(await test.json()).toEqual({ message: 'Server Error' })
    for (const call of logged.mock.calls) expect(String(call[0])).not.toContain('does not declare')
  })

  it('a framework answer is not checked: the malformed-body 400 of a contract route', async () => {
    const response = await bootApp().request('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    })
    expect(response.status).toBe(400)
    expect(logged).not.toHaveBeenCalled()
  })

  it('an unknown error is unchanged: the generic 500, logged as it is, in dev and in test', async () => {
    const app = bootApp()
    const dev = await app.request('/api/users/unknown')
    expect(dev.status).toBe(500)
    expect(await dev.json()).toEqual({ message: 'Server Error' })
    expect(logged).toHaveBeenLastCalledWith(thrown)

    vi.stubEnv('NODE_ENV', 'test')
    const test = await app.request('/api/users/unknown')
    expect(test.status).toBe(500)
    expect(logged).toHaveBeenLastCalledWith(thrown)
    // never the undeclared line: a plain error is the generic 500 already
    for (const call of logged.mock.calls) expect(String(call[0])).not.toContain('does not declare')
  })

  it('a responsible 0.5 Exception with a 5xx status is not checked: its body carries no code', async () => {
    const app = bootApp()
    const dev = await app.request('/api/users/failing')
    const failure = thrown
    expect(dev.status).toBe(503)
    expect(await dev.json()).toEqual({ message: 'Server Error' })
    // the exception filter's own 5xx log, never the undeclared line
    expect(logged).toHaveBeenCalledTimes(1)
    expect(logged).toHaveBeenCalledWith(failure)

    vi.stubEnv('NODE_ENV', 'test')
    const test = await app.request('/api/users/failing')
    expect(test.status).toBe(503)                                   // the generic 503, not the test wrapper's 500
    expect(await test.json()).toEqual({ message: 'Server Error' })
    expect(logged).toHaveBeenCalledTimes(2)
    expect(logged.mock.calls[1]![0]).toBe(thrown)
    for (const call of logged.mock.calls) expect(String(call[0])).not.toContain('does not declare')
  })

  it('a failure inside the check keeps the original error, in dev and in test', async () => {
    // A route option whose declared pair cannot be read: the check fails after it classified the error, and the filter
    // answers the error's own 401, not one wrapping a check failure
    const brokenSet = [
      Object.defineProperty({ status: 409 }, 'code', { enumerable: true, get() { throw new TypeError('broken def') } }),
    ] as never
    class Legacy extends Controller { index() { throw (thrown = new UnauthorizedException()) } }
    const container = new Container({ deps: depsRegistry })
    const app = new Hono()
    container.instance(HTTP_APP, app)
    new RequestKernel(container).boot()
    new ResponseKernel(container).boot()
    app.get('/broken-set', RequestKernel.handle({
      method: 'get', path: '/broken-set', errors: brokenSet, controller: [Legacy, 'index'],
    }))

    const dev = await app.request('/broken-set')
    expect(dev.status).toBe(401)
    expect(await dev.json()).toEqual({ code: 'UNAUTHORIZED', message: 'You are not authorized to perform this action.' })
    expect(logged).toHaveBeenCalledTimes(1)
    expect(logged).toHaveBeenCalledWith(
      '[@laratype/http] the undeclared-error check failed, the thrown error is unchanged:',
      expect.any(TypeError),
    )

    logged.mockClear()
    vi.stubEnv('NODE_ENV', 'test')
    const test = await app.request('/broken-set')
    expect(test.status).toBe(401)                                   // not the test wrapper's generic 500
    expect(await test.json()).toEqual({ code: 'UNAUTHORIZED', message: 'You are not authorized to perform this action.' })
    expect(logged).toHaveBeenCalledTimes(1)
    expect(String(logged.mock.calls[0]![0])).not.toContain('does not declare')
  })

  it('a 0.5 route is not checked', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    class Legacy extends Controller { index() { throw Undeclared() } }
    const container = new Container({ deps: depsRegistry })
    const app = new Hono()
    container.instance(HTTP_APP, app)
    new RequestKernel(container).boot()
    new ResponseKernel(container).boot()
    app.get('/legacy', RequestKernel.handle({ method: 'get', path: '/legacy', controller: [Legacy, 'index'] }))
    const response = await app.request('/legacy')
    expect(response.status).toBe(418)
    expect((await response.json()).code).toBe('TEAPOT')
    expect(logged).not.toHaveBeenCalled()
  })

  it('a contract route mounted without Route.api has no resolved set: it is not checked', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    class Raw extends Controller { index() { throw Undeclared() } }
    const container = new Container({ deps: depsRegistry })
    const app = new Hono()
    container.instance(HTTP_APP, app)
    new RequestKernel(container).boot()
    new ResponseKernel(container).boot()
    // The endpoint alone cannot say which contract or scope throws the route inherits, so the route is left unchecked
    app.get('/raw', RequestKernel.handle({
      method: 'get', path: '/raw', endpoint: users.undeclared, controller: [Raw, 'index'],
    }))
    const response = await app.request('/raw')
    expect(response.status).toBe(418)
    expect(logged).not.toHaveBeenCalled()
  })
})

describe('guarded diagnostics', () => {
  /** A console whose diagnostic lines throw, as a broken transport would: the filter's own error logs still work. */
  const throwingConsole = () => {
    logged.mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].startsWith('[@laratype/http]')) throw new TypeError('console down')
    })
  }

  it('a toJson() that throws keeps the original error, logged on the check-failed line', async () => {
    // The check reads the body code, so a broken toJson() is a check failure, not a route error replacement. The filter
    // cannot serialize that body either (it throws in onError), so the fetch wrapper answers the generic 500 and logs it
    class BrokenBody extends UnauthorizedException {
      override toJson(): any { throw new TypeError('broken body') }
    }
    const response = await bootApp([throwingMiddleware(() => new BrokenBody())]).request('/api/users/declared')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ message: 'Server Error' })
    expect(logged).toHaveBeenCalledWith(
      '[@laratype/http] the undeclared-error check failed, the thrown error is unchanged:',
      expect.any(TypeError),
    )
  })

  it('a body whose code descriptor throws is a check failure, not a route error replacement', async () => {
    // The check reads the code's property descriptor: a Proxy trap that throws is a check failure, and the filter still
    // answers the error (its own serialization walks no keys, so the body is `{}`)
    const payload = new Proxy({}, { getOwnPropertyDescriptor() { throw new TypeError('trap') } })
    class Trapped extends UnauthorizedException {
      override toJson(): any { return payload }
    }
    const failure = new Trapped()
    const response = await bootApp([throwingMiddleware(() => failure)]).request('/api/users/declared')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({})
    expect(logged).toHaveBeenCalledWith(
      '[@laratype/http] the undeclared-error check failed, the thrown error is unchanged:',
      expect.any(TypeError),
    )
  })

  it('a console.error that throws does not replace the undeclared error, in dev and in test', async () => {
    const app = bootApp()
    throwingConsole()

    const dev = await app.request('/api/users/undeclared')
    expect(dev.status).toBe(418)
    expect(await dev.json()).toEqual({ code: 'TEAPOT', message: 'TEAPOT' })

    vi.stubEnv('NODE_ENV', 'test')
    const test = await app.request('/api/users/undeclared')
    expect(test.status).toBe(500)                                   // the wrapper is thrown before the guarded write
    expect(await test.json()).toEqual({ message: 'Server Error' })
    expect((logged.mock.calls.at(-1)![0] as Error).cause).toBe(thrown)
  })

  it('an error whose util.inspect.custom throws does not replace it, in dev and in test', async () => {
    const failure = Undeclared()
    // Node's console formats its arguments with util.inspect, which calls that method
    Object.defineProperty(failure, Symbol.for('nodejs.util.inspect.custom'), {
      value() { throw new TypeError('inspect failed') },
    })
    // Only the thrown error is inspected: the filter logs the test-mode wrapper, a plain Error
    logged.mockImplementation((...args: unknown[]) => {
      for (const value of args) if (value === failure) inspect(value)
    })
    const app = bootApp([throwingMiddleware(() => failure)])

    const dev = await app.request('/api/users/declared')
    expect(dev.status).toBe(418)
    expect(await dev.json()).toEqual({ code: 'TEAPOT', message: 'TEAPOT' })

    vi.stubEnv('NODE_ENV', 'test')
    const test = await app.request('/api/users/declared')
    expect(test.status).toBe(500)                                   // the wrapper escapes, the inspect failure does not
    expect((logged.mock.calls.at(-1)![0] as Error).message).toBe(undeclaredLine('users.declared', 418, 'TEAPOT'))
  })
})
