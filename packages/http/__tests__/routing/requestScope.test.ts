// D6 #112: RequestKernel gives each request its own request scope and disposes it after the response is resolved
import 'reflect-metadata'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { Container, __laratype_deps, depsRegistry } from '@laratype/core'
import { HTTP_APP } from '@laratype/support'
import { Controller, RequestKernel } from '../../src/index'

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

/** The process-wide set of keys already warned about; reset per test so the bubbling warning always fires. */
const BUBBLE_WARNED = Symbol.for('laratype.di.bubbleWarned')

let nextId = 0
class RequestId {
  readonly id = ++nextId
}
class Repo {
  constructor(readonly requestId: RequestId) {}
}
class Service {
  constructor(readonly repo: Repo, readonly requestId: RequestId) {}
}
class ScopeController extends Controller {
  constructor(readonly service: Service, readonly requestId: RequestId) {
    super()
  }
  async index() {
    const before = this.describe()
    // Let the other request run in between
    await tick()
    return { before, after: this.describe() }
  }
  describe() {
    return [this.requestId.id, this.service.requestId.id, this.service.repo.requestId.id]
  }
}
// What the sauf DI transform emits for the constructors above
__laratype_deps(Repo, [() => RequestId], { params: ['requestId'] })
__laratype_deps(Service, [() => Repo, () => RequestId], { params: ['repo', 'requestId'] })
__laratype_deps(ScopeController, [() => Service, () => RequestId], { params: ['service', 'requestId'] })

/** A request-scoped value whose disposer rejects, for the disposal-failure tests. */
class Leaky {
  async [Symbol.asyncDispose]() {
    throw new Error('close failed')
  }
}
class LeakyController extends Controller {
  constructor(readonly leaky: Leaky) { super() }
  index() { return { ok: true } }
}
__laratype_deps(LeakyController, [() => Leaky], { params: ['leaky'] })

/** A Hono app booted like `sauf dev` does: the container holds it, and RequestKernel registers its middleware. */
const bootApp = (bind: (container: Container) => void) => {
  const container = new Container({ deps: depsRegistry })
  const app = new Hono()
  container.instance(HTTP_APP, app)
  bind(container)
  const kernel = new RequestKernel(container)
  kernel.boot()
  return { app, container, kernel }
}

beforeAll(() => {
  globalThis.__laratype_route_model_bindings = {}
})

afterEach(() => {
  delete (globalThis as { [BUBBLE_WARNED]?: unknown })[BUBBLE_WARNED]
  vi.restoreAllMocks()
})

describe('request scope under RequestKernel', () => {
  it('two parallel requests never share request-scoped or bubbled instances', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Service is a singleton that depends on a request-scoped value, so it bubbles to request scope
    const { app } = bootApp((container) => container.scoped(RequestId).scoped(Repo).singleton(Service))
    app.get('/scope', RequestKernel.handle({ method: 'get', path: '/scope', controller: [ScopeController, 'index'] }))
    const bodies = await Promise.all([1, 2, 3, 4].map(async () => (await app.request('/scope')).json()))
    const ids = bodies.map(({ before, after }: { before: number[], after: number[] }) => {
      // every instance of one request sees the same RequestId, before and after the other requests ran
      expect(new Set([...before, ...after]).size).toBe(1)
      return before[0]
    })
    expect(new Set(ids).size).toBe(4)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[@laratype/core] Service is a singleton but depends on request-scoped Repo'))
  })

  it('disposes the request-scoped values once the response is resolved, on success and on error', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const disposed: string[] = []
    class Unit {
      [Symbol.dispose]() { disposed.push('unit') }
    }
    class UnitController extends Controller {
      constructor(readonly unit: Unit) { super() }
      index() {
        disposed.push('handler')
        return { ok: true }
      }
      show() {
        throw new Error('boom')
      }
    }
    __laratype_deps(UnitController, [() => Unit], { params: ['unit'] })
    const { app, kernel } = bootApp((container) => container.scoped(Unit))
    app.onError((_error, c) => c.text('error', 500))
    app.get('/unit', RequestKernel.handle({ method: 'get', path: '/unit', controller: [UnitController, 'index'] }))
    app.get('/unit/fail', RequestKernel.handle({ method: 'get', path: '/unit/fail', controller: [UnitController, 'show'] }))
    expect((await app.request('/unit')).status).toBe(200)
    await kernel.settled()
    expect(disposed).toEqual(['handler', 'unit'])
    disposed.length = 0
    expect((await app.request('/unit/fail')).status).toBe(500)
    await kernel.settled()
    expect(disposed).toEqual(['unit'])
  })

  it('a slow disposer does not delay the response', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let started = false
    let disposed = false
    class Slow {
      async [Symbol.asyncDispose]() {
        started = true
        await gate
        disposed = true
      }
    }
    class SlowController extends Controller {
      constructor(readonly slow: Slow) { super() }
      index() { return { ok: true } }
    }
    __laratype_deps(SlowController, [() => Slow], { params: ['slow'] })
    const { app, kernel } = bootApp((container) => container.scoped(Slow))
    app.get('/slow', RequestKernel.handle({ method: 'get', path: '/slow', controller: [SlowController, 'index'] }))
    const response = await app.request('/slow')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    // The disposal started, and the response resolved without waiting for it
    expect(started).toBe(true)
    expect(disposed).toBe(false)
    release()
    await kernel.settled()
    expect(disposed).toBe(true)
  })

  it('a disposer that never settles does not hang the request', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    let started = 0
    const never = new Promise<void>(() => {})
    class Stuck {
      [Symbol.asyncDispose]() {
        started++
        return never
      }
    }
    class StuckController extends Controller {
      constructor(readonly stuck: Stuck) { super() }
      index() { return { ok: true } }
    }
    __laratype_deps(StuckController, [() => Stuck], { params: ['stuck'] })
    const { app } = bootApp((container) => container.scoped(Stuck))
    app.get('/stuck', RequestKernel.handle({ method: 'get', path: '/stuck', controller: [StuckController, 'index'] }))
    const response = await app.request('/stuck')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    // The disposal ran and stayed pending: the request did not wait for it
    expect(started).toBe(1)
  })

  it('a failed disposal is logged once and never changes the response', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const { app, kernel } = bootApp((container) => container.scoped(Leaky))
    app.get('/leaky', RequestKernel.handle({ method: 'get', path: '/leaky', controller: [LeakyController, 'index'] }))
    try {
      const response = await app.request('/leaky')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
      await kernel.settled()
      // `unhandledRejection` is emitted a turn later, after the microtasks that settled the disposal
      await tick()
      expect(error).toHaveBeenCalledTimes(1)
      expect(error.mock.calls[0]![0]).toBe('[@laratype/http] GET /leaky: disposing the request scope failed')
      expect(error.mock.calls[0]![1]).toBeInstanceOf(AggregateError)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('escapes control characters in the logged path', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { app, kernel } = bootApp((container) => container.scoped(Leaky))
    // One segment, so `:rest` matches the decoded path: Hono's `*` middleware skips a `%0A` path on its own
    app.get('/:rest', RequestKernel.handle({ method: 'get', path: '/leaky', controller: [LeakyController, 'index'] }))
    const response = await app.request('/leaky%0Aforged%20line')
    expect(response.status).toBe(200)
    await kernel.settled()
    await tick()
    // Hono decodes the path (`%0A` is a newline), so the log line escapes it instead of starting a forged line (CWE-117)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0]![0]).toBe('[@laratype/http] GET /leaky\\u000aforged line: disposing the request scope failed')
  })
})
