// A5 #288: request.bearerToken() and request.ip() read Hono's request and connection, never X-Forwarded-For
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { HonoRequest } from 'hono/request'
import { serve, type ServerType } from '@hono/node-server'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { Controller, Request as LaratypeRequest, RequestKernel, ResponseKernel } from '../../src/index'

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

class WhoAmI extends Controller {
  index(request: LaratypeRequest) {
    return { ip: request.ip(), token: request.bearerToken() }
  }
}

/** An app booted like `sauf dev`, with one route answering the request's ip() and bearerToken(). */
const bootApp = () => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  app.get('/whoami', RequestKernel.handle({ method: 'get', path: '/whoami', controller: [WhoAmI, 'index'] }))
  return app
}

describe('request.ip()', () => {
  let server: ServerType
  let origin: string

  beforeAll(async () => {
    globalThis.__laratype_route_model_bindings = {}
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const app = bootApp()
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve())
    })
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    vi.restoreAllMocks()
    await new Promise((resolve) => server.close(resolve))
  })

  it('returns the socket address on the Node adapter', async () => {
    const response = await fetch(`${origin}/whoami`, { headers: { Authorization: 'bearer abc' } })
    expect(await response.json()).toEqual({ ip: '127.0.0.1', token: 'abc' })
  })

  it('never reads X-Forwarded-For or X-Real-IP', async () => {
    const response = await fetch(`${origin}/whoami`, { headers: { 'X-Forwarded-For': '203.0.113.7', 'X-Real-IP': '203.0.113.8' } })
    expect(await response.json()).toEqual({ ip: '127.0.0.1', token: '' })
  })

  it('returns the address of the Bun server', async () => {
    const requestIP = vi.fn(() => ({ address: '192.0.2.10', family: 'IPv4', port: 51234 }))
    const response = await bootApp().request('/whoami', {}, { requestIP })
    expect(await response.json()).toEqual({ ip: '192.0.2.10', token: '' })
    expect(requestIP).toHaveBeenCalledTimes(1)
  })

  it('reads the bindings from env.server when the env wraps them, as getConnInfo does', async () => {
    const incoming = { socket: { remoteAddress: '198.51.100.4', remotePort: 51234, remoteFamily: 'IPv4' } }
    expect(await (await bootApp().request('/whoami', {}, { server: { incoming } })).json()).toEqual({ ip: '198.51.100.4', token: '' })
    const requestIP = () => ({ address: '192.0.2.11', family: 'IPv4', port: 51234 })
    expect(await (await bootApp().request('/whoami', {}, { server: { requestIP } })).json()).toEqual({ ip: '192.0.2.11', token: '' })
    // env.server without bindings wins over env's own, so there is nothing to read, and no error
    expect(await (await bootApp().request('/whoami', {}, { incoming, server: {} })).json()).toEqual({ ip: '', token: '' })
  })

  it('returns "" when the Bun server has no address for the request (a unix socket)', async () => {
    const response = await bootApp().request('/whoami', {}, { requestIP: () => null })
    expect(await response.json()).toEqual({ ip: '', token: '' })
  })

  it('returns "" for a request that came from no socket', async () => {
    const response = await bootApp().request('/whoami', { headers: { 'X-Forwarded-For': '203.0.113.7' } })
    expect(await response.json()).toEqual({ ip: '', token: '' })
  })

  it('keeps the Hono context out of the request\'s own keys', async () => {
    class Keys extends Controller {
      index(request: LaratypeRequest) {
        return { keys: Object.keys(request), ip: request.ip() }
      }
    }
    const app = bootApp()
    app.get('/keys', RequestKernel.handle({ method: 'get', path: '/keys', controller: [Keys, 'index'] }))
    const requestIP = () => ({ address: '192.0.2.12', family: 'IPv4', port: 51234 })
    expect(await (await app.request('/keys', {}, { requestIP })).json()).toEqual({ keys: ['requestCtx'], ip: '192.0.2.12' })
  })

  it('returns "" for a request built without the Hono context', () => {
    expect(new LaratypeRequest(new HonoRequest(new Request('http://localhost/'))).ip()).toBe('')
  })
})
