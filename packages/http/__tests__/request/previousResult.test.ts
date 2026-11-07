// H21 #269: the 0.5 previousResult of a middleware is per request, even when a binding makes it a singleton
import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { Controller, Middleware, RequestKernel, ResponseKernel, defineRouteGroup } from '../../src/index'
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

/** Each run of the two mounts of one singleton: what it read before and after the downstream middleware ran. */
const mounts: Array<{ run: number, start: unknown, after: unknown }> = []
let sharedBuilt = 0

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

/** A 0.5 middleware that reads the protected field directly, as 0.5 code does. */
class ReadsField extends Middleware<string> {
  async handle(_request: Request, _res: Response, next: (request: unknown) => unknown) {
    fieldReads.push(this.previousResult)
    return next(this.previousResult)
  }
}
const fieldReads: unknown[] = []

/** Gives the rest of the stack its own previous result, after Remember's. */
class Touch extends Middleware {
  async handle(_request: Request, _res: Response, next: (request: unknown) => unknown) {
    return next('touched')
  }
}

/** One singleton mounted at the group and at the route level: each mount must keep its own previous result. */
class Shared extends Middleware {
  constructor() { super(); sharedBuilt++ }

  private runs = 0

  async handle(_request: Request, _res: Response, next: (request: unknown) => unknown) {
    const run = this.runs++
    const start = this.getPreviousResult()
    const result = await next(`run-${run}`)
    mounts.push({ run, start, after: this.getPreviousResult() })
    return result
  }
}

describe('RequestKernel.handle: previousResult', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    seen.length = 0
    rememberBuilt = 0
    mounts.length = 0
    sharedBuilt = 0
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

  it('keeps the group and route mounts of one singleton independent', async () => {
    quiet()
    const app = bootApp((container) => container.singleton(Shared))
    defineRouteGroup('/api', {
      path: '/',
      middleware: [Mark, Shared],
      children: [{ path: '/shared/:value', method: 'get', controller: [Responder, 'show'], middleware: [Shared] }],
    }, { apps: app } as never)
    const response = await app.request('/api/shared/marked')
    expect(response.status).toBe(200)
    // One instance served both mounts
    expect(sharedBuilt).toBe(1)
    // The route mount's run starts with what the group mount passed to next(); after the route mount finishes, the
    // group mount still reads its own previous result ('marked', from Mark), not the route mount's run
    expect(mounts).toEqual([
      { run: 1, start: 'run-0', after: 'run-0' },
      { run: 0, start: 'marked', after: 'marked' },
    ])
  })

  it('serves the 0.5 protected field inside a request', async () => {
    quiet()
    fieldReads.length = 0
    const app = bootApp(() => {})
    app.get('/field/:value', RequestKernel.handle({
      method: 'get',
      path: '/field/:value',
      controller: [Responder, 'show'],
      middleware: [Mark, ReadsField],
    }))
    expect((await app.request('/field/marked')).status).toBe(200)
    expect(fieldReads).toEqual(['marked'])
  })

  it('keeps the field and the accessors in sync outside a request context', () => {
    const middleware = new ReadsField() as unknown as { previousResult: unknown } & ReadsField
    middleware.previousResult = 'written'
    expect(middleware.getPreviousResult()).toBe('written')
  })

  it('keeps the instance fallback outside a request context', () => {
    const middleware = new Remember()
    middleware.setPreviousResult('standalone')
    expect(middleware.getPreviousResult()).toBe('standalone')
  })
})
