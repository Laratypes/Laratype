// H21 #269: the 0.5 previousResult of a middleware is per request, even when a binding makes it a singleton
import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { Controller, Middleware, RequestKernel, ResponseKernel } from '../../src/index'
import type { Request } from '../../src/index'

/** An app booted like `sauf dev`: RequestKernel runs the pipeline, ResponseKernel handles its errors. */
const bootApp = (bind?: (container: Container) => void) => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  bind?.(container)
  new RequestKernel(container).boot()
  new ResponseKernel(container).boot()
  return app
}

const quiet = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

class Responder extends Controller {
  show() { return { one: true } }
}

/** What each request saw before `next()`, after its await, and after the downstream middleware ran. */
const seen: Array<{ start: unknown, end: unknown, after: unknown }> = []
let rememberBuilt = 0

/** Passes its (request-specific) path value to the rest of the stack. */
class Mark extends Middleware {
  async handle(request: Request, _res: Response, next: (request: unknown) => unknown) {
    return next(request.param('value'))
  }
}

class Remember extends Middleware {
  constructor() { super(); rememberBuilt++ }

  async handle(request: Request, _res: Response, next: (request: unknown) => unknown) {
    const start = this.getPreviousResult()
    // The first request is still waiting when the second one reads its value
    await new Promise((resolve) => setTimeout(resolve, request.param('value') === 'first' ? 20 : 0))
    const end = this.getPreviousResult()
    const result = await next('shared')
    seen.push({ start, end, after: this.getPreviousResult() })
    return result
  }
}

/** Gives the rest of the stack its own previous result, after Remember's. */
class Touch extends Middleware {
  async handle(_request: Request, _res: Response, next: (request: unknown) => unknown) {
    return next('touched')
  }
}

describe('RequestKernel.handle: previousResult', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    seen.length = 0
    rememberBuilt = 0
  })

  it('is per request for a singleton middleware whose requests interleave across an await', async () => {
    quiet()
    const app = bootApp((container) => container.singleton(Remember))
    app.get('/remember/:value', RequestKernel.handle({
      method: 'get',
      path: '/remember/:value',
      controller: [Responder, 'show'],
      middleware: [Mark, Remember, Touch],
    }))
    const responses = await Promise.all([app.request('/remember/first'), app.request('/remember/second')])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    // One instance served both, and each read only the value its own Mark passed, before and after next()
    expect(rememberBuilt).toBe(1)
    expect(seen).toEqual([
      { start: 'second', end: 'second', after: 'second' },
      { start: 'first', end: 'first', after: 'first' },
    ])
  })

  it('keeps the instance fallback outside a request context', () => {
    const middleware = new Remember()
    middleware.setPreviousResult('standalone')
    expect(middleware.getPreviousResult()).toBe('standalone')
  })
})
