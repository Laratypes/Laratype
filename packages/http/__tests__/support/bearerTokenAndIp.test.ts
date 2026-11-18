// A5 #288, H30 #299: request.bearerToken() reads the request, request.ip() reads the getConnInfo its serving adapter
// registered, never X-Forwarded-For or the shape of the runtime's env
import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { HonoRequest } from 'hono/request'
import type { Context } from 'hono'
import type { GetConnInfo } from 'hono/conninfo'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { Controller, mountConnInfo, Request as LaratypeRequest, RequestKernel, ResponseKernel } from '../../src/index'
import { HONO_CONTEXT } from '../../src/supports/Request'

const bearerToken = (authorization?: string) => {
  const headers: Record<string, string> = authorization === undefined ? {} : { Authorization: authorization }
  return new LaratypeRequest(new HonoRequest(new Request('http://localhost/', { headers }))).bearerToken()
}

describe('request.bearerToken()', () => {
  it('returns the token of a Bearer header, whatever the case of the scheme', () => {
    expect(bearerToken('Bearer abc.DEF-1_2~3+4/5=')).toBe('abc.DEF-1_2~3+4/5=')
    expect(bearerToken('bearer abc')).toBe('abc')
    expect(bearerToken('BEARER abc')).toBe('abc')
    expect(bearerToken('Bearer   abc  ')).toBe('abc')
  })

  it('returns "" with no header, another scheme or a malformed token', () => {
    expect(bearerToken()).toBe('')
    expect(bearerToken('')).toBe('')
    expect(bearerToken('Basic dXNlcjpwYXNz')).toBe('')
    expect(bearerToken('Bearer')).toBe('')
    expect(bearerToken('Bearer ')).toBe('')
    expect(bearerToken('Bearerabc')).toBe('')
    expect(bearerToken('Bearer abc def')).toBe('')
    expect(bearerToken('Token Bearer abc')).toBe('')
  })
})

/**
 * The node adapter's `getConnInfo`, structurally: the socket of the incoming request. A request with no socket
 * throws, as the real one does; ip() answers undefined instead of failing the route.
 */
const nodeConnInfo: GetConnInfo = (c) => {
  const { socket } = (c.env as { incoming: { socket: { remoteAddress: string } } }).incoming
  return { remote: { address: socket.remoteAddress } }
}

/**
 * `hono/bun`'s `getConnInfo`, structurally: `Server.requestIP()`, from `env.server` when the env wraps the server.
 * `requestIP()` answering null throws here too, as Hono's reads `info.address` on the null.
 */
const bunConnInfo: GetConnInfo = (c) => {
  const server = 'server' in (c.env as object)
    ? (c.env as { server: { requestIP(request: Request): { address: string, family?: string, port?: number } | null } }).server
    : (c.env as { requestIP(request: Request): { address: string, family?: string, port?: number } | null })
  const info = server.requestIP(c.req.raw)
  return { remote: { address: info.address, port: info.port, addressType: info.family === 'IPv4' || info.family === 'IPv6' ? info.family : undefined } }
}

class WhoAmI extends Controller {
  index(request: LaratypeRequest) {
    return { ip: request.ip(), token: request.bearerToken() }
  }
}

/**
 * An app booted like `sauf dev`, with one route answering the request's ip() and bearerToken(). The adapter's getConnInfo
 * is mounted before RequestKernel.boot(), as the node entry mounts it before the providers add the routes.
 */
const bootApp = (getConnInfo?: GetConnInfo) => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  if (getConnInfo) mountConnInfo(app, getConnInfo)
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  app.get('/whoami', RequestKernel.handle({ method: 'get', path: '/whoami', controller: [WhoAmI, 'index'] }))
  return app
}

/** ip() for an app with a getter that answers `address`, through the in-process app.request(). */
const ipFor = async (address: unknown) =>
  (await (await bootApp(() => ({ remote: { address } }) as never).request('/whoami')).json() as { ip?: string }).ip

/** The /whoami body; JSON drops an undefined ip, so its absence is what a no-address answer looks like. */
const whoami = async (app: Hono, init?: RequestInit, env?: unknown) =>
  await (await app.request('/whoami', init, env)).json() as { ip?: string, token: string }

describe('request.ip()', () => {
  beforeAll(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  it('returns the socket address the node adapter registered', async () => {
    const body = await whoami(bootApp(nodeConnInfo), {}, {
      incoming: { socket: { remoteAddress: '198.51.100.4', remotePort: 51234, remoteFamily: 'IPv4' } },
    })
    expect(body).toEqual({ ip: '198.51.100.4', token: '' })
  })

  it('returns the address the Bun adapter registered, calling requestIP() once', async () => {
    const requestIP = vi.fn(() => ({ address: '192.0.2.10', family: 'IPv4', port: 51234 }))
    const body = await whoami(bootApp(bunConnInfo), {}, { requestIP })
    expect(body).toEqual({ ip: '192.0.2.10', token: '' })
    expect(requestIP).toHaveBeenCalledTimes(1)
  })

  it('reads the server of env.server when the adapter getter does', async () => {
    const requestIP = () => ({ address: '192.0.2.11', family: 'IPv4', port: 51234 })
    expect(await whoami(bootApp(bunConnInfo), {}, { server: { requestIP } })).toEqual({ ip: '192.0.2.11', token: '' })
  })

  it('passes the Hono context of the request to the registered getter', async () => {
    const getConnInfo = vi.fn(() => ({ remote: { address: '203.0.113.9' } }))
    expect(await whoami(bootApp(getConnInfo))).toEqual({ ip: '203.0.113.9', token: '' })
    const ctx = getConnInfo.mock.calls[0]![0] as unknown as Context
    expect(ctx.req.path).toBe('/whoami')
  })

  it('returns undefined when no adapter registered a getConnInfo', async () => {
    const body = await whoami(bootApp())
    expect(body).toEqual({ token: '' })
    expect(body.ip).toBeUndefined()
  })

  it('returns undefined when the Bun server has no address for the request (a unix socket)', async () => {
    const body = await whoami(bootApp(bunConnInfo), {}, { requestIP: () => null })
    expect(body).toEqual({ token: '' })
    expect(body.ip).toBeUndefined()
  })

  it('returns undefined for a getConnInfo that throws, never failing the route', async () => {
    const response = await bootApp(() => {
      throw new Error('no socket on this adapter')
    }).request('/whoami')
    expect(response.status).toBe(200)
    const body = await response.json() as { ip?: string, token: string }
    expect(body).toEqual({ token: '' })
    expect(body.ip).toBeUndefined()
  })

  it('returns undefined when the getter answers no connection info, or no address', async () => {
    const answers: unknown[] = [undefined, null, 42, '203.0.113.7', {}, { remote: null }, { remote: {} }]
    for (const answer of answers) {
      const body = await whoami(bootApp(() => answer as never))
      expect(body, String(answer)).toEqual({ token: '' })
      expect(body.ip, String(answer)).toBeUndefined()
    }
  })

  it('returns undefined for an address that is not a non-empty string', async () => {
    const addresses: unknown[] = [42, NaN, Infinity, null, undefined, true, {}, { length: 1e9 }, ['203.0.113.7']]
    for (const address of addresses) expect(await ipFor(address)).toBeUndefined()
  })

  it('returns undefined for an empty address, a blank one, and one with control characters', async () => {
    const addresses = ['', ' ', '\u0000', '203.0.113.7\r\nX-Forwarded-For: 10.0.0.1', '203.0.113.7\u2028', '\ud800']
    for (const address of addresses) expect(await ipFor(address)).toBeUndefined()
  })

  it('returns undefined for a very long address, reading no header text', async () => {
    expect(await ipFor('1'.repeat(100_000))).toBeUndefined()
    expect(await ipFor(`${'203.0.113.7,'.repeat(10_000)}10.0.0.1`)).toBeUndefined()
  })

  it('normalizes an IPv4-mapped IPv6 address to IPv4, whatever its case', async () => {
    expect(await ipFor('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(await ipFor('::FFFF:203.0.113.7')).toBe('203.0.113.7')
    expect(await ipFor('0:0:0:0:0:ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(await ipFor('::ffff:0.0.0.0')).toBe('0.0.0.0')
    // The IPv4-translated range (::ffff:0:a.b.c.d) is not the mapped range: it stays an IPv6 address
    expect(await ipFor('::ffff:0:203.0.113.7')).toBe('::ffff:0:203.0.113.7')
  })

  it('strips an IPv6 zone id and returns a plain IPv6 address unchanged', async () => {
    expect(await ipFor('fe80::1%eth0')).toBe('fe80::1')
    expect(await ipFor('fe80::1%3')).toBe('fe80::1')
    expect(await ipFor('2001:db8::1')).toBe('2001:db8::1')
    expect(await ipFor('::1')).toBe('::1')
    expect(await ipFor('%eth0')).toBeUndefined()
  })

  it('never reads X-Forwarded-For or X-Real-IP', async () => {
    const headers = { 'X-Forwarded-For': '203.0.113.7', 'X-Real-IP': '203.0.113.8' }
    const env = { incoming: { socket: { remoteAddress: '127.0.0.1', remotePort: 51234, remoteFamily: 'IPv4' } } }
    expect(await whoami(bootApp(nodeConnInfo), { headers }, env)).toEqual({ ip: '127.0.0.1', token: '' })
    const body = await whoami(bootApp(), { headers })
    expect(body).toEqual({ token: '' })
    expect(body.ip).toBeUndefined()
  })

  it('refuses a getConnInfo that is not a function, and an app that is not a Hono app', () => {
    const on = new Hono()
    const getConnInfo = () => ({ remote: { address: '127.0.0.1' } })
    for (const value of [undefined, null, 42, 'getConnInfo', {}, []]) {
      expect(() => mountConnInfo(on, value as never), String(value)).toThrow(
        new TypeError(`[@laratype/http] mountConnInfo(): expected the runtime's getConnInfo(context) function, got ${typeof value}`),
      )
    }
    for (const value of [undefined, null, 42, 'app', {}, { use: 42 }]) {
      expect(() => mountConnInfo(value as never, getConnInfo), String(value)).toThrow(
        new TypeError(`[@laratype/http] mountConnInfo(): expected a Hono app, got ${value === null ? 'null' : typeof value}`),
      )
    }
  })

  it('keeps the Hono context out of what logging or serializing the request copies', async () => {
    class Keys extends Controller {
      index(request: LaratypeRequest) {
        const descriptor = Object.getOwnPropertyDescriptor(request, HONO_CONTEXT)
        return {
          keys: Object.keys(request),
          spread: Object.getOwnPropertySymbols({ ...request }).length,
          attached: descriptor?.value !== undefined,
          enumerable: descriptor?.enumerable,
          ip: request.ip(),
        }
      }
    }
    const app = bootApp(() => ({ remote: { address: '192.0.2.12' } }))
    app.get('/keys', RequestKernel.handle({ method: 'get', path: '/keys', controller: [Keys, 'index'] }))
    expect(await (await app.request('/keys')).json()).toEqual({
      keys: ['requestCtx'], spread: 0, attached: true, enumerable: false, ip: '192.0.2.12',
    })
  })

  it('works for a request class with its own constructor that forwards only the request', async () => {
    class OwnConstructor extends LaratypeRequest {
      readonly built: boolean
      constructor(request: HonoRequest) {
        super(request)
        this.built = true
      }
    }
    class Own extends Controller {
      index(request: OwnConstructor) {
        return { built: request.built, ip: request.ip() }
      }
    }
    const app = bootApp(() => ({ remote: { address: '192.0.2.13' } }))
    app.get('/own', RequestKernel.handle({ method: 'get', path: '/own', controller: [Own, 'index'], request: OwnConstructor }))
    expect(await (await app.request('/own')).json()).toEqual({ built: true, ip: '192.0.2.13' })
  })

  it('works for a request class with its own honoCtx field', async () => {
    class OwnField extends LaratypeRequest {
      honoCtx = 'mine'
    }
    class Own extends Controller {
      index(request: OwnField) {
        return { honoCtx: request.honoCtx, ip: request.ip() }
      }
    }
    const app = bootApp(() => ({ remote: { address: '192.0.2.14' } }))
    app.get('/field', RequestKernel.handle({ method: 'get', path: '/field', controller: [Own, 'index'], request: OwnField }))
    const response = await app.request('/field')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ honoCtx: 'mine', ip: '192.0.2.14' })
  })

  it('returns undefined for a request built without the Hono context', () => {
    expect(new LaratypeRequest(new HonoRequest(new Request('http://localhost/'))).ip()).toBeUndefined()
  })
})
