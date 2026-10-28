// D6 #112: request scope, disposal and scope bubbling
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Container, DiError, Injectable, token } from '@laratype/core'
import type { DepsEntry } from '@laratype/core'

/** Test deps lookup in the S3 registry shape. */
const depsOf = (entries: [Function, DepsEntry][]) => new Map(entries)

const tick = () => new Promise((resolve) => setTimeout(resolve, 1))

/** The process-wide set of keys already warned about; reset per test so tests stay independent. */
const BUBBLE_WARNED = Symbol.for('laratype.di.bubbleWarned')

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // Each test uses its own classes, so the once-per-key warning set never hides a warning between tests.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  delete (globalThis as { [BUBBLE_WARNED]?: unknown })[BUBBLE_WARNED]
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('request scope', () => {
  it('scoped() builds once per request scope, and each request scope gets its own instance', () => {
    class RequestId {}
    const app = new Container().scoped(RequestId)
    const a = app.createRequestScope()
    const b = app.createRequestScope()
    expect(a.make(RequestId)).toBe(a.make(RequestId))
    expect(b.make(RequestId)).toBe(b.make(RequestId))
    expect(a.make(RequestId)).not.toBe(b.make(RequestId))
  })

  it('bind() with scope request and @Injectable({ scope: request }) are request-scoped too', () => {
    class Bound {}
    @Injectable({ scope: 'request' })
    class Autowired {}
    const app = new Container().bind(Bound, undefined, { scope: 'request' })
    const a = app.createRequestScope()
    const b = app.createRequestScope()
    expect(a.make(Bound)).toBe(a.make(Bound))
    expect(a.make(Bound)).not.toBe(b.make(Bound))
    expect(a.make(Autowired)).toBe(a.make(Autowired))
    expect(a.make(Autowired)).not.toBe(b.make(Autowired))
    // bind(Cls) without a scope uses the class's scope
    const bound = new Container().bind(Autowired).createRequestScope()
    expect(bound.make(Autowired)).toBe(bound.make(Autowired))
    expect(app.has(Autowired)).toBe(false)
  })

  it('a request-scoped value is built by the request scope, so per-request instance() values apply', () => {
    const REQUEST_ID = token<string>('requestId')
    class Session {
      constructor(readonly id: string) {}
    }
    const app = new Container({ deps: depsOf([[Session, { slots: [() => REQUEST_ID] }]]) }).scoped(Session)
    const a = app.createRequestScope().instance(REQUEST_ID, 'a')
    const b = app.createRequestScope().instance(REQUEST_ID, 'b')
    expect(a.make(Session).id).toBe('a')
    expect(b.make(Session).id).toBe('b')
  })

  it('a child of a request scope shares its request-scoped values', () => {
    class RequestId {}
    const scope = new Container().scoped(RequestId).createRequestScope()
    expect(scope.createChild().make(RequestId)).toBe(scope.make(RequestId))
  })

  it('a request scope started from a live one has its own cache, and neither disposes the other values', async () => {
    let disposed = 0
    class Db {
      [Symbol.dispose]() { disposed++ }
    }
    const outer = new Container().scoped(Db).createRequestScope()
    const inner = outer.createRequestScope()
    expect(inner.make(Db)).not.toBe(outer.make(Db))
    await outer.dispose()
    expect(disposed).toBe(1)
    // the inner scope is independent: still usable, its value not disposed with the outer one
    expect(inner.make(Db)).toBe(inner.make(Db))
    await inner.dispose()
    expect(disposed).toBe(2)
  })

  it('a nested request scope keeps resolving after the outer one is disposed, unlike a plain child', async () => {
    class Db {}
    const outer = new Container().scoped(Db).createRequestScope()
    const nested = outer.createRequestScope()
    const plainChild = outer.createChild()
    await outer.dispose()
    // The nested scope owns its cache, so the outer disposal doesn't spend it (di.md › dispose())
    expect(nested.make(Db)).toBe(nested.make(Db))
    expect(() => plainChild.make(Db)).toThrow(new DiError('Request scope already disposed.'))
    await nested.dispose()
  })

  it('transient and singleton bindings keep their lifetime inside a request scope', () => {
    class Clock {}
    class Config {}
    const app = new Container().bind(Clock).singleton(Config)
    const a = app.createRequestScope()
    const b = app.createRequestScope()
    expect(a.make(Clock)).not.toBe(a.make(Clock))
    expect(a.make(Config)).toBe(b.make(Config))
    expect(a.make(Config)).toBe(app.make(Config))
  })

  it('a transient that depends on a request-scoped value gets the request one', () => {
    class RequestId {}
    class Controller {
      constructor(readonly id: RequestId) {}
    }
    const app = new Container({ deps: depsOf([[Controller, { slots: [() => RequestId] }]]) }).scoped(RequestId)
    const scope = app.createRequestScope()
    const first = scope.make(Controller)
    const second = scope.make(Controller)
    expect(first).not.toBe(second)
    expect(first.id).toBe(second.id)
    expect(first.id).toBe(scope.make(RequestId))
    expect(warn).not.toHaveBeenCalled()
  })

  it('resolving a request-scoped key outside a request scope throws, with the requester', () => {
    class RequestId {}
    class Controller {
      constructor(readonly id: RequestId) {}
    }
    const app = new Container({ deps: depsOf([[Controller, { slots: [() => RequestId], meta: { params: ['id'] } }]]) })
      .scoped(RequestId)
    const fix = ' Fix: resolve it inside a request (from the container of `createRequestScope()`), or make it transient.'
    expect(() => app.make(RequestId)).toThrow(new DiError(
      `Cannot resolve RequestId: it is request-scoped but no request scope is active.${fix}`,
    ))
    expect(() => app.createChild().make(Controller)).toThrow(new DiError(
      `Cannot resolve RequestId: it is request-scoped but no request scope is active. Required by Controller constructor param #0 \`id\`.${fix}`,
    ))
  })

  it('a factory gets the request scope and can read per-request values', () => {
    const REQUEST_ID = token<string>('requestId')
    const GREETING = token<string>('greeting')
    const app = new Container().scoped(GREETING, (c) => `hello ${c.make(REQUEST_ID)}`)
    expect(app.createRequestScope().instance(REQUEST_ID, 'a').make(GREETING)).toBe('hello a')
  })

  it('cycles through request-scoped keys are detected and the scope recovers', () => {
    class A {
      constructor(readonly b: unknown) {}
    }
    class B {
      constructor(readonly a: A) {}
    }
    const app = new Container({ deps: depsOf([[A, { slots: [() => B] }], [B, { slots: [() => A] }]]) }).scoped(A).scoped(B)
    const scope = app.createRequestScope()
    expect(() => scope.make(A)).toThrow(new DiError('Circular dependency: A -> B -> A'))
    expect(() => scope.make(A)).toThrow(new DiError('Circular dependency: A -> B -> A'))
  })

  it('two concurrent requests never share request-scoped instances', async () => {
    class RequestId {}
    class Repo {
      constructor(readonly id: RequestId) {}
    }
    class Controller {
      constructor(readonly repo: Repo, readonly id: RequestId) {}
    }
    const app = new Container({
      deps: depsOf([[Repo, { slots: [() => RequestId] }], [Controller, { slots: [() => Repo, () => RequestId] }]]),
    }).scoped(RequestId).scoped(Repo)
    const request = async () => {
      const scope = app.createRequestScope()
      const seen: RequestId[] = []
      for (let i = 0; i < 5; i++) {
        const controller = scope.make(Controller)
        seen.push(controller.id, controller.repo.id)
        await tick()
      }
      await scope.dispose()
      return seen
    }
    const [a, b] = await Promise.all([request(), request()])
    expect(new Set(a).size).toBe(1)
    expect(new Set(b).size).toBe(1)
    expect(a[0]).not.toBe(b[0])
  })
})

describe('dispose()', () => {
  it('calls Symbol.asyncDispose or Symbol.dispose on the request-scoped values, newest first', async () => {
    const calls: string[] = []
    class Db {
      async [Symbol.asyncDispose]() {
        await tick()
        calls.push('db')
      }
    }
    class Uow {
      constructor(readonly db: Db) {}
      [Symbol.dispose]() { calls.push('uow') }
    }
    class Both {
      async [Symbol.asyncDispose]() { calls.push('both:async') }
      [Symbol.dispose]() { calls.push('both:sync') }
    }
    const app = new Container({ deps: depsOf([[Uow, { slots: [() => Db] }]]) }).scoped(Db).scoped(Uow).scoped(Both)
    const scope = app.createRequestScope()
    scope.make(Uow)
    scope.make(Both)
    await scope.dispose()
    expect(calls).toEqual(['both:async', 'uow', 'db'])
  })

  it('disposes a value cached under two keys once, where it was first built', async () => {
    const calls: string[] = []
    class Db { [Symbol.dispose]() { calls.push('db') } }
    class Uow {
      constructor(readonly db: Db) {}
      [Symbol.dispose]() { calls.push('uow') }
    }
    const DB_ALIAS = token<Db>('db alias')
    const app = new Container({ deps: depsOf([[Uow, { slots: [() => Db] }]]) })
      .scoped(Db)
      .scoped(Uow)
      .scoped(DB_ALIAS, (c: Container) => c.make(Db))
    const scope = app.createRequestScope()
    scope.make(Uow)
    expect(scope.make(DB_ALIAS)).toBe(scope.make(Db))
    await scope.dispose()
    expect(calls).toEqual(['uow', 'db'])
  })

  it('leaves transient, singleton and instance() values alone', async () => {
    const disposed: string[] = []
    const disposable = (name: string) => class { [Symbol.dispose]() { disposed.push(name) } }
    const Transient = disposable('transient')
    const Singleton = disposable('singleton')
    const VALUE = token<object>('value')
    const app = new Container().bind(Transient).singleton(Singleton)
    const scope = app.createRequestScope().instance(VALUE, new (disposable('instance'))())
    scope.make(Transient)
    scope.make(Singleton)
    scope.make(VALUE)
    await scope.dispose()
    expect(disposed).toEqual([])
  })

  it('does not call a dispose method under another name', async () => {
    const calls: string[] = []
    class Custom {
      dispose() { calls.push('dispose') }
      close() { calls.push('close') }
    }
    const scope = new Container().scoped(Custom).createRequestScope()
    scope.make(Custom)
    await scope.dispose()
    expect(calls).toEqual([])
  })

  it('runs every disposer and rethrows the failures as one AggregateError', async () => {
    const calls: string[] = []
    const first = new Error('first')
    const second = new Error('second')
    class A { [Symbol.dispose]() { calls.push('a'); throw first } }
    class B { [Symbol.dispose]() { calls.push('b') } }
    class C { async [Symbol.asyncDispose]() { calls.push('c'); throw second } }
    const scope = new Container().scoped(A).scoped(B).scoped(C).createRequestScope()
    scope.make(A)
    scope.make(B)
    scope.make(C)
    const error = await scope.dispose().catch((e: unknown) => e)
    expect(calls).toEqual(['c', 'b', 'a'])
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).message).toBe('Failed to dispose 2 request-scoped value(s).')
    expect((error as AggregateError).errors).toEqual([second, first])
  })

  it('a disposed scope refuses make(), a second dispose() does nothing, and the next request starts fresh', async () => {
    let disposed = 0
    class Db { [Symbol.dispose]() { disposed++ } }
    class Service {}
    class Job {}
    const app = new Container().scoped(Db).singleton(Service).transient(Job)
    const scope = app.createRequestScope()
    const db = scope.make(Db)
    await scope.dispose()
    await scope.dispose()
    expect(disposed).toBe(1)
    expect(() => scope.make(Db)).toThrow(new DiError('Request scope already disposed.'))
    // Every key throws, not just the request-scoped ones: a singleton, a transient and an autowired class too (#337)
    expect(() => scope.make(Service)).toThrow(new DiError('Request scope already disposed.'))
    expect(() => scope.make(Job)).toThrow(new DiError('Request scope already disposed.'))
    expect(() => scope.make(class Autowired {})).toThrow(new DiError('Request scope already disposed.'))
    expect(() => scope.createChild().make(Db)).toThrow(new DiError('Request scope already disposed.'))
    expect(() => scope.createRequestScope()).toThrow(new DiError('Request scope already disposed.'))
    expect(() => scope.createChild().createRequestScope()).toThrow(new DiError('Request scope already disposed.'))
    expect(app.createRequestScope().make(Db)).not.toBe(db)
  })

  it('only a request scope can be disposed', async () => {
    const app = new Container()
    await expect(app.dispose()).rejects.toThrow(new DiError('Only a request scope can be disposed.'))
    await expect(app.createChild().dispose()).rejects.toThrow(new DiError('Only a request scope can be disposed.'))
  })
})

describe('scope bubbling', () => {
  const message = (c: string, d: string) =>
    `[@laratype/core] ${c} is a singleton but depends on request-scoped ${d}, so it is resolved once per request. Make ${c} request-scoped (or transient) to silence this.`

  it('a singleton that depends on a request-scoped value becomes request-scoped, with one dev warning', () => {
    class RequestId {}
    class Controller {
      constructor(readonly id: RequestId) {}
    }
    const app = new Container({ deps: depsOf([[Controller, { slots: [() => RequestId] }]]) }).scoped(RequestId).singleton(Controller)
    const a = app.createRequestScope()
    const b = app.createRequestScope()
    const fromA = a.make(Controller)
    expect(a.make(Controller)).toBe(fromA)
    expect(fromA.id).toBe(a.make(RequestId))
    const fromB = b.make(Controller)
    expect(fromB).not.toBe(fromA)
    expect(fromB.id).toBe(b.make(RequestId))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(message('Controller', 'RequestId'))
    // once bubbled it is request-scoped: outside a request it throws
    expect(() => app.make(Controller)).toThrow('Cannot resolve Controller: it is request-scoped but no request scope is active.')
  })

  it('bubbles through transients and other singletons, and an autowired @Injectable singleton bubbles too', () => {
    class RequestId {}
    class Repo {
      constructor(readonly id: RequestId) {}
    }
    @Injectable({ scope: 'singleton' })
    class Service {
      constructor(readonly repo: Repo) {}
    }
    class Controller {
      constructor(readonly service: Service) {}
    }
    const app = new Container({
      deps: depsOf([
        [Repo, { slots: [() => RequestId] }],
        [Service, { slots: [() => Repo] }],
        [Controller, { slots: [() => Service] }],
      ]),
    }).scoped(RequestId).singleton(Controller)
    const a = app.createRequestScope()
    const b = app.createRequestScope()
    const fromA = a.make(Controller)
    expect(fromA.service).toBe(a.make(Service))
    expect(fromA.service.repo.id).toBe(a.make(RequestId))
    const fromB = b.make(Controller)
    expect(fromB).not.toBe(fromA)
    expect(fromB.service).not.toBe(fromA.service)
    expect(fromB.service.repo.id).toBe(b.make(RequestId))
    expect(warn.mock.calls.map(([text]) => text)).toEqual([message('Service', 'RequestId'), message('Controller', 'RequestId')])
  })

  it('a bubbled singleton is still built by the container that owns its binding', () => {
    class RequestId {}
    class Clock {}
    class LocalClock extends Clock {}
    class Controller {
      constructor(readonly id: RequestId, readonly clock: Clock) {}
    }
    const app = new Container({ deps: depsOf([[Controller, { slots: [() => RequestId, () => Clock] }]]) })
      .scoped(RequestId)
      .singleton(Controller)
    const scope = app.createRequestScope().bind(Clock, LocalClock)
    const controller = scope.make(Controller)
    expect(controller.clock).not.toBeInstanceOf(LocalClock)
    expect(controller.id).toBe(scope.make(RequestId))
  })

  it('bubbled singletons are disposed with the request', async () => {
    let disposed = 0
    class RequestId {}
    class Controller {
      constructor(readonly id: RequestId) {}
      [Symbol.dispose]() { disposed++ }
    }
    const app = new Container({ deps: depsOf([[Controller, { slots: [() => RequestId] }]]) }).scoped(RequestId).singleton(Controller)
    for (let i = 0; i < 2; i++) {
      const scope = app.createRequestScope()
      scope.make(Controller)
      await scope.dispose()
    }
    expect(disposed).toBe(2)
  })

  it('warns once per key per process, and never in production', () => {
    class RequestId {}
    class Quiet {
      constructor(readonly id: RequestId) {}
    }
    const deps = depsOf([[Quiet, { slots: [() => RequestId] }]])
    vi.stubGlobal('__PROD__', true)
    new Container({ deps }).scoped(RequestId).singleton(Quiet).createRequestScope().make(Quiet)
    expect(warn).not.toHaveBeenCalled()
    vi.stubGlobal('__PROD__', undefined)
    new Container({ deps }).scoped(RequestId).singleton(Quiet).createRequestScope().make(Quiet)
    new Container({ deps }).scoped(RequestId).singleton(Quiet).createRequestScope().make(Quiet)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('stays silent when __PROD__ is unset and NODE_ENV is production, and shares the warned set with a second copy', () => {
    class RequestId {}
    class Quiet {
      constructor(readonly id: RequestId) {}
    }
    const deps = depsOf([[Quiet, { slots: [() => RequestId] }]])
    vi.stubGlobal('__PROD__', undefined)
    vi.stubEnv('NODE_ENV', 'production')
    new Container({ deps }).scoped(RequestId).singleton(Quiet).createRequestScope().make(Quiet)
    expect(warn).not.toHaveBeenCalled()
    // A second copy of @laratype/core finds the keys already warned about under the shared symbol
    vi.stubEnv('NODE_ENV', 'development')
    ;(globalThis as { [BUBBLE_WARNED]?: Set<unknown> })[BUBBLE_WARNED] = new Set([Quiet])
    new Container({ deps }).scoped(RequestId).singleton(Quiet).createRequestScope().make(Quiet)
    expect(warn).not.toHaveBeenCalled()
  })

  it('a singleton without request-scoped deps stays a singleton, and instance() values never bubble', () => {
    class RequestId {}
    class Config {}
    const VALUE = token<{ id?: RequestId }>('value')
    const app = new Container().scoped(RequestId).singleton(Config).instance(VALUE, {})
    const a = app.createRequestScope()
    const b = app.createRequestScope()
    expect(a.make(Config)).toBe(b.make(Config))
    expect(a.make(VALUE)).toBe(b.make(VALUE))
    expect(warn).not.toHaveBeenCalled()
  })
})
