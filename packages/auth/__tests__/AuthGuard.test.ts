// A5 #288: AuthGuard reads the token with request.bearerToken(), so the Bearer scheme ignores case
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, depsRegistry } from '@laratype/core'
import { ContextApi, HTTP_APP } from '@laratype/support'
import { Controller, RequestKernel, ResponseKernel } from '@laratype/http'
import AuthGuard from '../src/guard/Auth'
import { AuthVerification } from '../src/verifications'

const USER = { id: 1, name: 'Ada' }

class Me extends Controller {
  index() {
    return { user: ContextApi.getUser() }
  }
}

/** An app booted like `sauf dev`, with one route behind AuthGuard. */
const bootApp = () => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  app.get('/me', RequestKernel.handle({ method: 'get', path: '/me', controller: [Me, 'index'], middleware: [AuthGuard] }))
  return app
}

let verify: ReturnType<typeof vi.spyOn>

beforeAll(() => {
  globalThis.__laratype_route_model_bindings = {}
})

afterEach(() => {
  vi.restoreAllMocks()
})

const request = (authorization?: string) => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  verify = vi.spyOn(AuthVerification, 'verify').mockImplementation(async (token: string) => (token === 'valid.token' ? USER : false))
  return bootApp().request('/me', { headers: authorization === undefined ? {} : { Authorization: authorization } })
}

const MISSING = { code: 'UNAUTHORIZED', message: 'Token is missing or invalid.' }

describe('AuthGuard', () => {
  it.each(['Bearer valid.token', 'bearer valid.token', 'BEARER valid.token'])('authenticates %s', async (authorization) => {
    const response = await request(authorization)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ user: USER })
    expect(verify).toHaveBeenCalledWith('valid.token')
  })

  it.each([
    ['a missing header', undefined],
    ['a Basic header', 'Basic dXNlcjpwYXNz'],
    ['a Bearer header with no token', 'Bearer'],
    // RFC 6750 b64token only, as Hono's bearerAuth: a Sanctum-style token is rejected before verify
    ['a token outside the b64token grammar', 'Bearer 1|abc'],
  ])('answers the existing 401 for %s', async (_, authorization) => {
    const response = await request(authorization)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(MISSING)
    expect(verify).not.toHaveBeenCalled()
  })

  it('answers the existing 401 for a token that does not verify', async () => {
    const response = await request('Bearer other.token')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: 'UNAUTHORIZED', message: 'Token is invalid or expired.' })
  })
})
