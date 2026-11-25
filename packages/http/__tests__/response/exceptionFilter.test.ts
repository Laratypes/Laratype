// H5 #108: the exception filter maps a thrown contract error to its own status and `{ code, ...body }`, tells errors
// by brand (not instanceof), and answers anything else, non-Error throws included, with the generic 500
import 'reflect-metadata'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, depsRegistry } from '@laratype/core'
import { Exception, HTTP_APP, NotFoundException } from '@laratype/support'
import { defineApi, defineContract, defineError, endpoint, errors, isContractError } from '@laratype/contract'
import { Controller, Middleware, RequestKernel, ResponseKernel, Route } from '../../src/index'

const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const

/** An app booted like `sauf dev`: RequestKernel puts the container on each request, ResponseKernel handles errors. */
const bootApp = (before?: (app: Hono) => void) => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  // H33 #313: the catch middleware has to be mounted before the routes to wrap them, as `sauf dev` bootstraps it
  // (ResponseKernel.register() runs before the providers' boot)
  new ResponseKernel(container).register()
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

  it('a body with its own toJSON keeps the declared code: the top-level toJSON is dropped', async () => {
    quiet()
    const Taken = defineError(409, 'EMAIL_TAKEN', () => ({ toJSON: () => ({ message: 'Taken.' }), email: 'ada@example.com' }))
    await expectBody(await throwing(() => Taken()), 409, { code: 'EMAIL_TAKEN', email: 'ada@example.com' })
    expect(logged).not.toHaveBeenCalled()
  })

  it('a body getter that throws answers the generic 500 like an unserializable body, logged once', async () => {
    quiet()
    const Exploding = defineError(409, 'EXPLODING', () => ({ get detail(): string { throw new TypeError('getter') } }))
    const error = Exploding()
    const response = await throwing(() => error)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expectBody(response, 500, GENERIC)
    expect(logged).toHaveBeenCalledTimes(1)
    expect(logged).toHaveBeenCalledWith(error, expect.any(TypeError))
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
    const response = await throwing(() => error)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expectBody(response, 500, GENERIC)
    expect(logged).toHaveBeenCalledTimes(1)
    expect(logged).toHaveBeenCalledWith(error, expect.any(TypeError))
  })

  it('drops the cookie and cache headers set before the throw, as every error response does (#272)', async () => {
    quiet()
    class Users extends Controller { index() { throw EmailTaken('ada@example.com') } }
    const { app, boot } = bootApp((app) => app.use(async (c, next) => {
      c.header('Set-Cookie', 'session=abc')
      c.header('Cache-Control', 'public, max-age=60')
      await next()
    }))
    app.get('/cookie', RequestKernel.handle({ method: 'get', path: '/cookie', controller: [Users, 'index'] }))
    boot()
    const response = await app.request('/cookie')
    expect(response.status).toBe(409)
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
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
      getErrorCode() { return 'NOT_FOUND' }
      canResponsible() { return true }
      getHttpCode() { return 404 }
      toJson() { return { code: 'NOT_FOUND', message: 'No such post.' } }
    }
    Object.defineProperty(ForeignNotFound.prototype, Symbol.for('laratype.exception'), { value: true })
    await expectBody(await throwing(() => new ForeignNotFound('No such post.')), 404, { code: 'NOT_FOUND', message: 'No such post.' })
  })
})

// X3 #392, H32 #312: the status of a responsible Exception is app data. A value the platform cannot send must answer
// the generic 500, never a 200 that says nothing went wrong
describe('an Exception status the platform cannot send', () => {
  class WeirdStatus extends Exception {
    constructor(private readonly sent: unknown) {
      super({ code: 'WEIRD', message: 'secret detail', responsible: true, reportable: false })
    }
    override getHttpCode() { return this.sent as never }
  }

  it.each([
    ['a numeric string', '503'],
    ['a bigint', 503n],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['a negative number', -1],
    ['1e9', 1e9],
    ['99', 99],
    ['600', 600],
    ['a fractional number', 1.5],
    ['null', null],
    ['undefined', undefined],
    ['an object', { length: 1e9 }],
    // H33 #313: a success status is no error answer, so an Exception never sends one
    ['200', 200],
    ['204', 204],
    ['a redirect', 301],
    ['399', 399],
  ])('%s answers the generic 500, never 200', async (_, status) => {
    quiet()
    const failure = new WeirdStatus(status)
    const response = await throwing(() => failure)
    await expectBody(response, 500, GENERIC)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(logged).toHaveBeenCalledWith(failure)
  })

  it('a valid integer status still sends its body', async () => {
    quiet()
    await expectBody(await throwing(() => new WeirdStatus(418)), 418, { code: 'WEIRD', message: 'secret detail' })
    expect(logged).not.toHaveBeenCalled()
  })
})

// X3 #392, H32 #312: a toJson() that throws, or a body JSON cannot hold, keeps the exception's own status with the
// generic body: the filter's own failure must not replace the answer with a 500 that loses the status
describe('an Exception body that cannot be built', () => {
  class BrokenBody extends Exception {
    constructor(private readonly sent: number = 409) {
      super({ code: 'BROKEN', message: 'secret detail', responsible: true, reportable: false })
    }
    override getHttpCode() { return this.sent as never }
    override toJson(): any { throw new TypeError('broken body') }
  }

  class UnserializableBody extends Exception {
    constructor() {
      super({ code: 'BROKEN', message: 'secret detail', responsible: true, reportable: false, httpCode: 409 })
    }
    override toJson(): any { return { detail: 'secret detail', size: 1n } }
  }

  it('a toJson() that throws keeps the original 4xx status and the generic body, logged', async () => {
    quiet()
    const failure = new BrokenBody()
    const response = await throwing(() => failure)
    await expectBody(response, 409, GENERIC)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(logged).toHaveBeenCalledWith(failure, expect.any(TypeError))
  })

  it('a console that throws while the toJson failure is logged still keeps the original status and the generic body', async () => {
    quiet()
    // a broken console adapter (or a util.inspect.custom that throws) must not turn the answer into the adapter's raw 500
    logged.mockImplementation(() => { throw new Error('console broke') })
    const response = await throwing(() => new BrokenBody())
    await expectBody(response, 409, GENERIC)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(logged).toHaveBeenCalled()
  })

  it('a body JSON cannot hold keeps the original 4xx status too', async () => {
    quiet()
    const response = await throwing(() => new UnserializableBody())
    await expectBody(response, 409, GENERIC)
  })

  it('a 5xx body is not built at all: the generic body goes out', async () => {
    quiet()
    const failure = new BrokenBody(503)
    const toJson = vi.spyOn(failure, 'toJson')
    await expectBody(await throwing(() => failure), 503, GENERIC)
    // skipped, not a thrown toJson() caught into the same generic 503: the spy proves the body was never serialized
    expect(toJson).not.toHaveBeenCalled()
  })
})

// H20 #267, H4 #107, H32 #312: the endpoint's declared 2xx never overrides a thrown error's own status
describe('a declared 201 or 202 endpoint', () => {
  const Conflict = defineError(409, 'CONFLICT', () => ({ message: 'Taken.' }))
  const created = defineContract()({ store: endpoint.post('/').response(anything, 201).throws(Conflict) })
  const accepted = defineContract()({ store: endpoint.post('/').status(202).throws(Conflict) })

  it.each([
    ['201', created, '/api/created'],
    ['202', accepted, '/api/accepted'],
  ] as const)('keeps the thrown error status over the declared %s', async (_, contract, path) => {
    quiet()
    class Conflicts extends Controller { store() { throw Conflict() } }
    const { app, boot } = bootApp()
    Route.api(defineApi({ conflicts: { contract, path, scopes: [], dirs: [] } }), (r) => [r.contract(contract, Conflicts)]).mount(app)
    boot()
    await expectBody(await app.request(path, { method: 'POST' }), 409, { code: 'CONFLICT', message: 'Taken.' })
  })
})

describe('non-Error throws', () => {
  it.each([
    ['a string', () => 'secret detail'],
    ['an object', () => ({ secret: 'detail' })],
    ['undefined', () => undefined],
    ['zero', () => 0],
    ['false', () => false],
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

  it('a fetch that throws synchronously answers the generic 500 too', async () => {
    quiet()
    const { app, boot } = bootApp()
    app.fetch = () => { throw 'secret detail' }
    boot()
    const response = app.fetch(new Request('http://localhost/'))
    expect(response).toBeInstanceOf(Response)
    await expectBody(response as Response, 500, GENERIC)
    expect(logged).toHaveBeenCalledWith('secret detail')
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

  // H33 #313: the catch middleware replaces the fetch wrapper, so the non-Error 500 now carries what the filter adds
  it('a non-Error throw carries the middleware headers, nosniff and no-store', async () => {
    quiet()
    class Failing extends Controller { index() { throw 'secret detail' } }
    const { app, boot } = bootApp((app) => app.use(async (c, next) => {
      c.header('Access-Control-Allow-Origin', 'https://app.example.test')
      c.header('Vary', 'Origin')
      await next()
    }))
    app.get('/fail', RequestKernel.handle({ method: 'get', path: '/fail', controller: [Failing, 'index'] }))
    boot()
    const response = await app.request('/fail')
    await expectBody(response, 500, GENERIC)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test')
    expect(response.headers.get('Vary')).toBe('Origin')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(logged).toHaveBeenCalledWith('secret detail')
  })

  it('a non-Error from the not-found handler answers the generic 500', async () => {
    quiet()
    const { app, boot } = bootApp()
    app.notFound(() => { throw 'secret detail' })
    boot()
    await expectBody(await app.request('/missing'), 500, GENERIC)
    expect(logged).toHaveBeenCalledTimes(1)
  })

  it('a non-Error from an app mounted with parent.route() answers the generic 500 with the parent headers', async () => {
    quiet()
    const container = new Container({ deps: depsRegistry })
    const child = new Hono()
    container.instance(HTTP_APP, child)
    // The child's fetch wrapper is bypassed by parent.route(): its catch middleware is copied with its routes instead
    new ResponseKernel(container).register()
    class Failing extends Controller { index() { throw 'secret detail' } }
    child.get('/fail', RequestKernel.handle({ method: 'get', path: '/fail', controller: [Failing, 'index'] }))
    new ResponseKernel(container).boot()
    const parent = new Hono()
    parent.use(async (c, next) => { c.header('Access-Control-Allow-Origin', 'https://app.example.test'); await next() })
    parent.route('/sub', child)
    const response = await parent.request('/sub/fail')
    await expectBody(response, 500, GENERIC)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.test')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('a ContractError from another realm answers its declared status and body, not a 500', async () => {
    quiet()
    // A real other realm: the brand is the shared `Symbol.for` key, while the value is not an `instanceof Error` here
    const foreign = runInNewContext(`(() => {
      class ContractError extends Error {
        constructor() {
          super('The email is taken.')
          this.name = 'ContractError'
          this.status = 409
          this.code = 'EMAIL_TAKEN'
          this.body = { message: 'The email is taken.' }
          Object.defineProperty(this, Symbol.for('laratype.contract-error'), { value: true })
        }
      }
      return new ContractError()
    })()`)
    expect(foreign).not.toBeInstanceOf(Error)
    expect(isContractError(foreign)).toBe(true)
    class Failing extends Controller { index() { throw foreign } }
    const { app, boot } = bootApp()
    app.get('/foreign', RequestKernel.handle({ method: 'get', path: '/foreign', controller: [Failing, 'index'] }))
    boot()
    const response = await app.request('/foreign')
    await expectBody(response, 409, { code: 'EMAIL_TAKEN', message: 'The email is taken.' })
    // A contract error is an expected answer: the filter does not log it
    expect(logged).not.toHaveBeenCalled()
  })

  it('a throw out of the exception filter answers the generic 500, never an unhandled rejection', async () => {
    quiet()
    const filter = vi.spyOn(ResponseKernel.prototype, 'resolveException').mockImplementation(() => { throw 'filter failure' })
    class Failing extends Controller { index() { throw new Error('secret detail') } }
    const { app, boot } = bootApp()
    app.get('/fail', RequestKernel.handle({ method: 'get', path: '/fail', controller: [Failing, 'index'] }))
    boot()
    const response = await app.request('/fail')
    await expectBody(response, 500, GENERIC)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    // The filter ran for the route error and again for its own failure
    expect(filter).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a symbol', () => Symbol('secret detail')],
    ['an object whose toString throws', () => ({ toString() { throw new TypeError('toString') } })],
    ['an object whose status getter throws', () => Object.defineProperty({}, 'status', { get() { throw new TypeError('status getter') } })],
  ])('%s thrown by a controller answers the logged generic 500 and never crashes', async (_, value) => {
    quiet()
    const response = await throwing(value)
    await expectBody(response, 500, GENERIC)
    expect(logged).toHaveBeenCalledTimes(1)
  })
})
