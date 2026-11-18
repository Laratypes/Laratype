// X3 #157: an error a route throws without declaring it on the running endpoint is reported in dev, answers the generic
// 500 in test, and is sent unchanged in production (docs/v1/http.md › Undeclared-error check)
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP, UnauthorizedException } from '@laratype/support'
import { defineApi, defineContract, defineError, endpoint, errors } from '@laratype/contract'
import { Controller, Middleware, RequestKernel, ResponseKernel, Route } from '../../src/index'
import type { MiddlewareClass } from '../../src/index'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const

const Declared = defineError(409, 'EMAIL_TAKEN', () => ({ message: 'The email is taken.' }))
const AtContract = defineError(402, 'PAYMENT_REQUIRED')
const AtEndpoint = defineError(410, 'GONE')
const Undeclared = defineError(418, 'TEAPOT')
const ServerFailure = defineError(503, 'UNAVAILABLE')

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
}, { throws: [AtContract] })

const usersApi = defineApi({ users: { contract: users, path: '/api/users', scopes: [] } })

/** The error the controller throws last, so a test can check the filter received that very object. */
let thrown: Error

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

describe('what is not checked', () => {
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
    class BrokenCode extends UnauthorizedException {
      override getErrorCode(): string { throw new TypeError('broken code') }
    }
    const failure = new BrokenCode()
    const app = bootApp([throwingMiddleware(() => failure)])

    const dev = await app.request('/api/users/declared')
    expect(dev.status).toBe(401)
    expect(await dev.json()).toEqual({ code: 'UNAUTHORIZED', message: failure.message })
    expect(logged).toHaveBeenCalledTimes(1)
    expect(logged).toHaveBeenCalledWith(
      '[@laratype/http] the undeclared-error check failed, the thrown error is unchanged:',
      expect.any(TypeError),
    )

    logged.mockClear()
    vi.stubEnv('NODE_ENV', 'test')
    const test = await app.request('/api/users/declared')
    expect(test.status).toBe(401)                                   // not the test wrapper's generic 500
    expect(await test.json()).toEqual({ code: 'UNAUTHORIZED', message: failure.message })
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
