// H32 #312 / X3 #392: checklist-a inputs of the exception filter and the 0.5 response path. A status the platform
// cannot send never answers 200, a throwing Exception getter or a Proxy response is the generic 500, and a header
// object cannot inject a header (mixed case is the same name, a control character is refused, a prototype is not a
// header list)
import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, depsRegistry } from '@laratype/core'
import { Exception, HTTP_APP, MetaDataKey } from '@laratype/support'
import { defineApi, defineContract, endpoint } from '@laratype/contract'
import { Controller, RequestKernel, Response as LaratypeResponse, ResponseKernel, Route } from '../../src/index'

const GENERIC = { message: 'Server Error' }

/** A Standard Schema that accepts every value: the status and header tests need no response contract */
const anything = { '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) } } as const

/** An app booted like `sauf dev`: RequestKernel puts the container on each request, ResponseKernel handles errors. */
const bootApp = () => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  return app
}

const route = (app: Hono, path: string, controller: new () => Controller, method = 'index') =>
  app.get(path, RequestKernel.handle({ method: 'get', path, controller: [controller as never, method] }))

let logged: ReturnType<typeof vi.spyOn>

const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  logged = vi.spyOn(console, 'error').mockImplementation(() => {})
}

afterEach(() => {
  vi.restoreAllMocks()
})

const expectGeneric500 = async (response: Response, ...hidden: string[]) => {
  expect(response.status).toBe(500)
  const text = await response.text()
  expect(JSON.parse(text)).toEqual(GENERIC)
  for (const value of hidden) expect(text).not.toContain(value)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
}

describe('a 0.5 Response status the platform cannot send', () => {
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
    ['0', 0],
    ['a { length: 1e9 } object', { length: 1e9 }],
  ])('%s answers the generic 500, never 200', async (_, status) => {
    quiet()
    class Unsendable extends Controller { index() { return new LaratypeResponse({ ok: true, secret: 'detail' }, status as never) } }
    const app = bootApp()
    route(app, '/x', Unsendable)
    await expectGeneric500(await app.request('/x'), 'detail')
    // a server bug is logged once, as any unknown error, with the refusal's diagnostic
    expect(logged).toHaveBeenCalledTimes(1)
    expect((logged.mock.calls[0]![0] as Error).message).toContain('cannot be sent: use an integer from 200 to 599')
  })

  it('an explicit null status means unset, like undefined: 200 with the handler headers (0.5 code sets headers this way)', async () => {
    quiet()
    class Unset extends Controller { index() { return new LaratypeResponse({ ok: true }, null as never, { 'X-Custom': 'kept' }) } }
    const app = bootApp()
    route(app, '/unset', Unset)
    const response = await app.request('/unset')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(response.headers.get('X-Custom')).toBe('kept')
    expect(logged).not.toHaveBeenCalled()
  })

  it.each([
    ['a numeric string', '201'],
    ['0', 0],
    ['NaN', NaN],
    ['an empty string', ''],
    ['false', false],
    ['0n', 0n],
  ])('a status decorator of %s answers the generic 500 too', async (_, status) => {
    quiet()
    class Decorated extends Controller { index() { return { ok: true, secret: 'detail' } } }
    Reflect.defineMetadata(MetaDataKey.CONTROLLER_STATUS_CODE, status, Decorated.prototype, 'index')
    const app = bootApp()
    route(app, '/decorated', Decorated)
    await expectGeneric500(await app.request('/decorated'), 'detail')
    expect(logged).toHaveBeenCalledTimes(1)
    expect((logged.mock.calls[0]![0] as Error).message).toContain('cannot be sent: use an integer from 200 to 599')
  })

  it('a redirect status the platform does not send answers the generic 500', async () => {
    quiet()
    class Redirected extends Controller { index() { return new LaratypeResponse(null).redirect('/login', 200 as never) } }
    const app = bootApp()
    route(app, '/redirect', Redirected)
    const response = await app.request('/redirect')
    await expectGeneric500(response)
    expect(response.headers.get('Location')).toBeNull()
    expect((logged.mock.calls[0]![0] as Error).message).toContain('the redirect status 200 cannot be sent')
  })

  it('a valid 500 Response keeps its status and body, with the header scrub', async () => {
    quiet()
    class Failing extends Controller {
      index() {
        return new LaratypeResponse({ message: 'the handler meant this' }, 500, {
          'sEt-CoOkIe': 'sid=abc; Path=/',
          'eTaG': '"v1"',
          'rEtRy-AfTeR': '30',
        })
      }
    }
    const app = bootApp()
    route(app, '/failing', Failing)
    const response = await app.request('/failing')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ message: 'the handler meant this' })
    // header names are case-insensitive, so the mixed-case ones are the ones #272 drops
    expect(response.headers.getSetCookie()).toEqual([])
    expect(response.headers.get('etag')).toBeNull()
    expect(response.headers.get('retry-after')).toBe('30')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('a responsible Exception whose getter throws', () => {
  const throwing = (make: () => unknown) => {
    class Throwing extends Controller { index() { throw make() } }
    const app = bootApp()
    route(app, '/throw', Throwing)
    return app.request('/throw')
  }

  class ThrowingStatus extends Exception {
    constructor() { super({ code: 'X', message: 'secret detail', responsible: true, reportable: false }) }
    override getHttpCode(): never { throw new TypeError('status getter') }
  }

  class ThrowingResponsible extends Exception {
    constructor() { super({ code: 'X', message: 'secret detail', responsible: true, reportable: false }) }
    override canResponsible(): never { throw new TypeError('responsible getter') }
  }

  it.each([
    ['getHttpCode()', () => new ThrowingStatus()],
    ['canResponsible()', () => new ThrowingResponsible()],
    ['the reportable getter', () => {
      const error = new Exception({ code: 'X', message: 'secret detail', responsible: true, reportable: false })
      Object.defineProperty(error, 'reportable', { get() { throw new TypeError('reportable getter') } })
      return error
    }],
  ])('%s fails closed: the generic 500, logged, no secret in the body', async (_, make) => {
    quiet()
    const response = await throwing(make)
    await expectGeneric500(response, 'secret')
    expect(logged).toHaveBeenCalledTimes(1)
  })
})

describe('a Proxy response', () => {
  it('a Response whose accessor throws is the generic 500, not a broken app', async () => {
    quiet()
    const inner = new LaratypeResponse({ ok: true, secret: 'detail' })
    const proxied = new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'getContent') throw new TypeError('proxy trap')
        return Reflect.get(target, property, receiver)
      },
    })
    class Trapped extends Controller { index() { return proxied } }
    const app = bootApp()
    route(app, '/proxy', Trapped)
    await expectGeneric500(await app.request('/proxy'), 'detail')
  })

  it('a 0.5 Response object with a throwing own header trap is the generic 500', async () => {
    quiet()
    class Hostile extends Controller {
      index() {
        const headers = new Proxy({}, {
          ownKeys() { throw new TypeError('header proxy') },
        })
        return new LaratypeResponse({ ok: true }, 200, headers)
      }
    }
    const app = bootApp()
    route(app, '/hostile', Hostile)
    await expectGeneric500(await app.request('/hostile'))
  })
})

describe('header names and values', () => {
  it('a mixed-case header is the same header: a 201 keeps it', async () => {
    quiet()
    const users = defineContract()({ create: endpoint.post('/').response(anything, 201) })
    class Users extends Controller {
      create() {
        return new LaratypeResponse({ id: 1 }, undefined, { 'lOcAtIoN': '/api/users/1', 'cOnTeNt-LoCaTiOn': '/api/users/1' })
      }
    }
    const app = bootApp()
    Route.api(defineApi({ users: { contract: users, path: '/api/users', scopes: [], dirs: [] } }), (r) => [r.contract(users, Users)]).mount(app)
    const response = await app.request('/api/users', { method: 'POST' })
    expect(response.status).toBe(201)
    expect(response.headers.get('location')).toBe('/api/users/1')
    expect(response.headers.get('content-location')).toBe('/api/users/1')
  })

  it('a very long header value is kept, never truncated into an error', async () => {
    quiet()
    const long = `Bearer ${'a'.repeat(8 * 1024)}`
    class Long extends Controller { index() { return new LaratypeResponse({ ok: true }, 503, { 'X-Long': long }) } }
    const app = bootApp()
    route(app, '/long', Long)
    const response = await app.request('/long')
    expect(response.status).toBe(503)
    expect(response.headers.get('x-long')).toBe(long)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('a header value with CR LF is refused, so it cannot inject a header', async () => {
    quiet()
    class Injected extends Controller {
      index() { return new LaratypeResponse({ ok: true }, 200, { 'X-Bad': 'value\r\nX-Injected: yes' }) }
    }
    const app = bootApp()
    route(app, '/injected', Injected)
    const response = await app.request('/injected')
    await expectGeneric500(response)
    expect(response.headers.get('x-injected')).toBeNull()
  })

  it('a header value with U+2028 is refused by the platform: generic 500, no injected header', async () => {
    quiet()
    class Separated extends Controller {
      index() { return new LaratypeResponse({ ok: true }, 200, { 'X-Bad': 'value\u2028X-Injected: yes' }) }
    }
    const app = bootApp()
    route(app, '/separated', Separated)
    const response = await app.request('/separated')
    await expectGeneric500(response)
    expect(response.headers.get('x-injected')).toBeNull()
  })

  it('a header value with a lone surrogate is refused by the platform: generic 500, no injected header', async () => {
    quiet()
    class Surrogate extends Controller {
      index() { return new LaratypeResponse({ ok: true }, 200, { 'X-Bad': 'value\uD800X-Injected: yes' }) }
    }
    const app = bootApp()
    route(app, '/surrogate', Surrogate)
    const response = await app.request('/surrogate')
    await expectGeneric500(response)
    expect(response.headers.get('x-injected')).toBeNull()
  })

  it('a C0 control character the platform accepts is data, never a second header', async () => {
    quiet()
    class Controlled extends Controller {
      index() { return new LaratypeResponse({ ok: true }, 200, { 'X-Bad': 'value\u0001X-Injected: yes' }) }
    }
    const app = bootApp()
    route(app, '/controlled', Controlled)
    const response = await app.request('/controlled')
    expect(response.status).toBe(200)
    expect(response.headers.get('x-injected')).toBeNull()
    expect(response.headers.get('x-bad')).toContain('\u0001')
  })

  it('only own enumerable header keys are sent: a prototype and a non-enumerable key are not headers', async () => {
    quiet()
    const inherited = Object.create({ 'X-Inherited': 'yes' }) as Record<string, string>
    inherited['X-Own'] = 'yes'
    Object.defineProperty(inherited, 'X-Hidden', { value: 'yes', enumerable: false })
    class Headers extends Controller { index() { return new LaratypeResponse({ ok: true }, 200, inherited) } }
    const app = bootApp()
    route(app, '/headers', Headers)
    const response = await app.request('/headers')
    expect(response.status).toBe(200)
    expect(response.headers.get('x-own')).toBe('yes')
    expect(response.headers.get('x-inherited')).toBeNull()
    expect(response.headers.get('x-hidden')).toBeNull()
  })

  it('a "__proto__" own key is data, and does not pollute the prototype', async () => {
    quiet()
    const headers = JSON.parse('{"__proto__": {"polluted": true}, "X-Ok": "yes"}') as Record<string, string>
    class Headers extends Controller { index() { return new LaratypeResponse({ ok: true }, 200, headers) } }
    const app = bootApp()
    route(app, '/proto', Headers)
    const response = await app.request('/proto')
    expect(response.status).toBe(200)
    expect(response.headers.get('x-ok')).toBe('yes')
    // the header value is stringified by Headers, never walked into Object.prototype
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
  })
})
