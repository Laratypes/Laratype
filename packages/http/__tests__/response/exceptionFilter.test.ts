// H5 #108: the exception filter maps a thrown contract error to its own status and `{ code, ...body }`, tells errors
// by brand (not instanceof), and answers anything else, non-Error throws included, with the generic 500
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP, NotFoundException } from '@laratype/support'
import { defineApi, defineContract, defineError, endpoint, errors } from '@laratype/contract'
import { Controller, Middleware, RequestKernel, ResponseKernel, Route } from '../../src/index'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const

/** An app booted like `sauf dev`: RequestKernel puts the container on each request, ResponseKernel handles errors. */
const bootApp = (before?: (app: Hono) => void) => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  before?.(app)
  return { app, boot: () => new ResponseKernel(container).boot() }
}

/** One GET route whose controller method throws `error`, served by a booted app. */
const throwing = (error: () => unknown) => {
  class Throwing extends Controller { index() { throw error() } }
  const { app, boot } = bootApp()
  app.get('/throw', RequestKernel.handle({ method: 'get', path: '/throw', controller: [Throwing, 'index'] }))
  boot()
  return app.request('/throw')
}

const GENERIC = { message: 'Server Error' }

let logged: ReturnType<typeof vi.spyOn>

beforeAll(() => {
  globalThis.__laratype_route_model_bindings = {}
})

const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  logged = vi.spyOn(console, 'error').mockImplementation(() => {})
}

afterEach(() => {
  vi.restoreAllMocks()
})

const expectBody = async (response: Response, status: number, body: unknown) => {
  expect(response.status).toBe(status)
  expect(response.headers.get('Content-Type')).toMatch(/^application\/json/)
  expect(await response.json()).toEqual(body)
}

describe('catalog errors', () => {
  it.each([
    ['401', () => errors.unauthorized(), 401, { code: 'UNAUTHORIZED', message: 'Unauthenticated.' }],
    ['403', () => errors.forbidden(), 403, { code: 'FORBIDDEN', message: 'This action is unauthorized.' }],
    ['404', () => errors.notFound(), 404, { code: 'NOT_FOUND', message: 'Not Found.' }],
    ['404 with a message', () => errors.notFound('No such post.'), 404, { code: 'NOT_FOUND', message: 'No such post.' }],
    ['422', () => errors.validation({ email: ['Required'], 'address.zip': ['Invalid'] }), 422, {
      code: 'VALIDATION_ERROR',
      message: 'The given data was invalid.',
      errors: { email: ['Required'], 'address.zip': ['Invalid'] },
    }],
    ['429', () => errors.tooManyRequests(), 429, { code: 'TOO_MANY_REQUESTS', message: 'Too Many Requests.' }],
  ])('a thrown %s answers its status with { code, ...body }, not logged', async (_, error, status, body) => {
    quiet()
    await expectBody(await throwing(error), status, body)
    expect(logged).not.toHaveBeenCalled()
  })

  it('the 0.5 NotFoundException (model binding) answers the same body as the catalog 404', async () => {
    quiet()
    await expectBody(await throwing(() => new NotFoundException('No such post.')), 404, { code: 'NOT_FOUND', message: 'No such post.' })
  })
})

describe('domain errors', () => {
  const EmailTaken = defineError(409, 'EMAIL_TAKEN', (email: string) => ({ message: 'The email is taken.', email }))

  it('a declared error thrown at any depth answers its own status and body, over the endpoint status, without a log', async () => {
    quiet()
    const users = defineContract()({ store: endpoint.post('/').response(anything, 201).throws(EmailTaken) })
    const usersApi = defineApi({ users: { contract: users, path: '/api/users', scopes: [], dirs: [] } })
    const register = async (email: string) => {
      await Promise.resolve()
      throw EmailTaken(email)
    }
    class Users extends Controller { async store() { await register('ada@example.com'); return {} } }
    const { app, boot } = bootApp()
    Route.api(usersApi, (r) => [r.contract(users, Users)]).mount(app)
    boot()
    await expectBody(await app.request('/api/users', { method: 'POST' }), 409, {
      code: 'EMAIL_TAKEN',
      message: 'The email is taken.',
      email: 'ada@example.com',
    })
    // an expected answer: no stack trace in the server log
    expect(logged).not.toHaveBeenCalled()
  })

  it('a declared 5xx keeps its own body: it is the error the contract declares', async () => {
    quiet()
    const Maintenance = defineError(503, 'MAINTENANCE', () => ({ message: 'Back soon.', retryAt: '2026-10-23T00:00:00Z' }))
    await expectBody(await throwing(() => Maintenance()), 503, { code: 'MAINTENANCE', message: 'Back soon.', retryAt: '2026-10-23T00:00:00Z' })
  })

  it('a contract error of another package copy is told by its brand', async () => {
    quiet()
    const foreign = () => Object.defineProperty(
      Object.assign(new Error('x'), { status: 409, code: 'EMAIL_TAKEN', body: { message: 'Taken.' } }),
      Symbol.for('laratype.contract-error'),
      { value: true },
    )
    await expectBody(await throwing(foreign), 409, { code: 'EMAIL_TAKEN', message: 'Taken.' })
  })

  it('an unbranded error with the same fields, or a contract error changed to a 2xx, is an unknown error', async () => {
    quiet()
    await expectBody(await throwing(() => Object.assign(new Error('secret detail'), { status: 409, code: 'EMAIL_TAKEN', body: {} })), 500, GENERIC)
    await expectBody(await throwing(() => Object.assign(EmailTaken('ada@example.com'), { status: 200 })), 500, GENERIC)
    expect(logged).toHaveBeenCalledTimes(2)
  })

  it('a body JSON cannot hold answers the generic 500, and the error is logged with the failure', async () => {
    quiet()
    const error = defineError(409, 'HUGE', () => ({ size: 1n }))()
    await expectBody(await throwing(() => error), 500, GENERIC)
    expect(logged).toHaveBeenCalledTimes(1)
    expect(logged).toHaveBeenCalledWith(error, expect.any(TypeError))
  })

  it('keeps the headers middleware set (CORS)', async () => {
    quiet()
    class Users extends Controller { index() { throw EmailTaken('ada@example.com') } }
    const { app, boot } = bootApp((app) => app.use(async (c, next) => {
      c.header('Access-Control-Allow-Origin', 'https://app.example.test')
      await next()
    }))
    app.get('/cors', RequestKernel.handle({ method: 'get', path: '/cors', controller: [Users, 'index'] }))
    boot()
    const response = await app.request('/cors')
    expect(response.status).toBe(409)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test')
  })
})

describe('Exceptions by brand', () => {
  it('a responsible Exception of another copy of @laratype/support keeps its status and body', async () => {
    quiet()
    class ForeignNotFound extends Error {
      canResponsible() { return true }
      getHttpCode() { return 404 }
      toJson() { return { code: 'NOT_FOUND', message: 'No such post.' } }
    }
    Object.defineProperty(ForeignNotFound.prototype, Symbol.for('laratype.exception'), { value: true })
    await expectBody(await throwing(() => new ForeignNotFound('No such post.')), 404, { code: 'NOT_FOUND', message: 'No such post.' })
  })
})

describe('non-Error throws', () => {
  it.each([
    ['a string', () => 'secret detail'],
    ['an object', () => ({ secret: 'detail' })],
    ['undefined', () => undefined],
  ])('%s thrown by a controller answers the generic 500 and is logged once', async (_, value) => {
    quiet()
    const response = await throwing(value)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expectBody(response, 500, GENERIC)
    expect(logged).toHaveBeenCalledTimes(1)
    expect(logged).toHaveBeenCalledWith(value())
  })

  it('a Hono middleware or a 0.5 middleware that throws one answers the generic 500', async () => {
    quiet()
    class Rejecting extends Middleware { handle() { return Promise.reject('secret detail') } }
    class Ok extends Controller { index() { return {} } }
    const { app, boot } = bootApp((app) => app.use('/hono', () => { throw 'secret detail' }))
    app.get('/hono', RequestKernel.handle({ method: 'get', path: '/hono', controller: [Ok, 'index'] }))
    app.get('/legacy', RequestKernel.handle({ method: 'get', path: '/legacy', middleware: [Rejecting], controller: [Ok, 'index'] }))
    boot()
    await expectBody(await app.request('/hono'), 500, GENERIC)
    await expectBody(await app.request('/legacy'), 500, GENERIC)
    expect(logged).toHaveBeenCalledTimes(2)
  })

  it('an Error still goes through the filter, with the context headers', async () => {
    quiet()
    class Failing extends Controller { index() { throw new Error('secret detail') } }
    const { app, boot } = bootApp((app) => app.use(async (c, next) => {
      c.header('Access-Control-Allow-Origin', 'https://app.example.test')
      await next()
    }))
    app.get('/fail', RequestKernel.handle({ method: 'get', path: '/fail', controller: [Failing, 'index'] }))
    boot()
    const response = await app.request('/fail')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test')
    await expectBody(response, 500, GENERIC)
  })
})
