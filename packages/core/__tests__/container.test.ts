import { describe, expect, it } from 'vitest'
import { Container, DiError, InjectionToken, token } from '@laratype/core'
import type { DepsEntry } from '@laratype/core'

abstract class Logger {
  abstract log(message: string): string
}

class ConsoleLogger extends Logger {
  log(message: string) {
    return `console: ${message}`
  }
}

class Clock {}

/** Test deps lookup in the S3 registry shape. */
const depsOf = (entries: [Function, DepsEntry][]) => new Map(entries)

describe('Container bindings', () => {
  it('bind() is transient by default', () => {
    const c = new Container().bind(Logger, ConsoleLogger)
    const a = c.make(Logger)
    expect(a).toBeInstanceOf(ConsoleLogger)
    expect(c.make(Logger)).not.toBe(a)
  })

  it('bind() with scope singleton reuses the instance', () => {
    const c = new Container().bind(Logger, ConsoleLogger, { scope: 'singleton' })
    expect(c.make(Logger)).toBe(c.make(Logger))
  })

  it('singleton() reuses the first instance', () => {
    const c = new Container().singleton(Logger, ConsoleLogger)
    expect(c.make(Logger)).toBeInstanceOf(ConsoleLogger)
    expect(c.make(Logger)).toBe(c.make(Logger))
  })

  it('singleton() without concrete binds a class to itself', () => {
    const c = new Container().singleton(Clock)
    expect(c.make(Clock)).toBeInstanceOf(Clock)
    expect(c.make(Clock)).toBe(c.make(Clock))
  })

  it('transient() creates a new value on every make()', () => {
    const c = new Container().transient(Logger, ConsoleLogger)
    expect(c.make(Logger)).not.toBe(c.make(Logger))
    const self = new Container().transient(Clock)
    expect(self.make(Clock)).not.toBe(self.make(Clock))
  })

  it('instance() returns the given value', () => {
    const logger = new ConsoleLogger()
    const c = new Container().instance(Logger, logger)
    expect(c.make(Logger)).toBe(logger)
  })

  it('accepts factories, called with the resolving container', () => {
    const NAME = token<string>('app.name')
    const c = new Container()
      .instance(NAME, 'laratype')
      .bind(Logger, (container) => ({ log: (m: string) => `${container.make(NAME)}: ${m}` }))
    expect(c.make(Logger).log('hi')).toBe('laratype: hi')
  })

  it('singleton factories run once', () => {
    let calls = 0
    const c = new Container().singleton(Clock, () => (calls++, new Clock()))
    c.make(Clock)
    c.make(Clock)
    expect(calls).toBe(1)
  })

  it('rebinding replaces the previous binding and its cached singleton', () => {
    const c = new Container().singleton(Logger, ConsoleLogger)
    const first = c.make(Logger)
    c.singleton(Logger, ConsoleLogger)
    expect(c.make(Logger)).not.toBe(first)
  })

  it('has() reports explicit bindings only', () => {
    const c = new Container().bind(Logger, ConsoleLogger)
    expect(c.has(Logger)).toBe(true)
    expect(c.has(Clock)).toBe(false)
    expect(c.make(Clock)).toBeInstanceOf(Clock)
    expect(c.has(Clock)).toBe(false)
  })
})

describe('tokens', () => {
  it('token() creates distinct named keys', () => {
    const a = token<string>('name')
    const b = token<string>('name')
    expect(a).toBeInstanceOf(InjectionToken)
    expect(a.name).toBe('name')
    expect(String(a)).toBe('InjectionToken(name)')
    const c = new Container().instance(a, 'a').instance(b, 'b')
    expect(c.make(a)).toBe('a')
    expect(c.make(b)).toBe('b')
  })

  it('binds a token to a class or factory', () => {
    const LOGGER = token<Logger>('logger')
    const c = new Container().singleton(LOGGER, ConsoleLogger)
    expect(c.make(LOGGER)).toBeInstanceOf(ConsoleLogger)
    expect(c.make(LOGGER)).toBe(c.make(LOGGER))
    const PORT = token<number>('port')
    expect(new Container().bind(PORT, () => 3000).make(PORT)).toBe(3000)
  })

  it('throws for an unbound token', () => {
    const MISSING = token<string>('missing')
    expect(() => new Container().make(MISSING)).toThrow(DiError)
    expect(() => new Container().make(MISSING)).toThrow('No binding for InjectionToken(missing).')
  })

  it('refuses to self-bind a token', () => {
    const T = token<string>('t')
    expect(() => new Container().bind(T as never)).toThrow(/only a class can be self-bound/)
  })
})

describe('autowiring', () => {
  class Mailer {}
  class Notifier {
    constructor(readonly mailer: Mailer, readonly logger: Logger) {}
  }

  it('builds zero-arg classes without registration or metadata', () => {
    expect(new Container().make(Clock)).toBeInstanceOf(Clock)
  })

  it('resolves constructor deps from the lookup, using bindings for abstract deps', () => {
    const deps = depsOf([[Notifier, { slots: [() => Mailer, () => Logger], meta: { params: ['mailer', 'logger'] } }]])
    const c = new Container({ deps }).singleton(Logger, ConsoleLogger)
    const n = c.make(Notifier)
    expect(n).toBeInstanceOf(Notifier)
    expect(n.mailer).toBeInstanceOf(Mailer)
    expect(n.logger).toBe(c.make(Logger))
    expect(c.make(Notifier)).not.toBe(n)
  })

  it('resolves token slots (`() => TOKEN`)', () => {
    const NAME = token<string>('name')
    class Greeter {
      constructor(readonly name: string) {}
    }
    const deps = depsOf([[Greeter, { slots: [() => NAME], meta: { params: ['name'] } }]])
    const c = new Container({ deps }).instance(NAME, 'world')
    expect(c.make(Greeter).name).toBe('world')
  })

  it('autowires a concrete class bound to an abstract one', () => {
    class FileLogger extends Logger {
      constructor(readonly clock: Clock) {
        super()
      }
      log(m: string) {
        return m
      }
    }
    const deps = depsOf([[FileLogger, { slots: [() => Clock] }]])
    const logger = new Container({ deps }).bind(Logger, FileLogger).make(Logger)
    expect(logger).toBeInstanceOf(FileLogger)
    expect((logger as FileLogger).clock).toBeInstanceOf(Clock)
  })

  it('passes undefined for optional unresolved slots', () => {
    class WithDefault {
      constructor(readonly label: string = 'default') {}
    }
    const deps = depsOf([[WithDefault, { slots: [{ unresolved: 'string', index: 0 }], meta: { params: ['label'], optional: [0] } }]])
    expect(new Container({ deps }).make(WithDefault).label).toBe('default')
  })

  it('throws on a required unresolved slot', () => {
    class Mixed {
      constructor(readonly name: string) {}
    }
    const deps = depsOf([[Mixed, { slots: [{ unresolved: 'string', index: 0 }], meta: { params: ['name'] } }]])
    expect(() => new Container({ deps }).make(Mixed))
      .toThrow('Cannot resolve Mixed constructor param #0 `name`: type `string` has no runtime value.')
  })

  it('throws when a thunk returns undefined', () => {
    const deps = depsOf([[Notifier, { slots: [() => undefined, () => Logger] }]])
    expect(() => new Container({ deps }).make(Notifier)).toThrow(/param #0: its type resolved to undefined/)
  })

  it('throws when a class with params has no metadata', () => {
    expect(() => new Container().make(Notifier)).toThrow(/Cannot autowire Notifier: its constructor takes 2 param/)
  })

  it('detects circular dependencies', () => {
    class A {
      constructor(readonly b: unknown) {}
    }
    class B {
      constructor(readonly a: A) {}
    }
    const deps = depsOf([[A, { slots: [() => B] }], [B, { slots: [() => A] }]])
    expect(() => new Container({ deps }).make(A)).toThrow('Circular dependency: A -> B -> A')
  })

  it('detects cycles through factories', () => {
    const c = new Container()
    c.bind(Logger, (container) => container.make(Logger))
    expect(() => c.make(Logger)).toThrow('Circular dependency: Logger -> Logger')
  })

  it('recovers after a failed resolution', () => {
    const c = new Container()
    expect(() => c.make(Notifier)).toThrow(DiError)
    expect(c.make(Clock)).toBeInstanceOf(Clock)
  })
})

describe('child containers', () => {
  class TestLogger extends Logger {
    log(m: string) {
      return `test: ${m}`
    }
  }

  it('sees parent bindings', () => {
    const parent = new Container().bind(Logger, ConsoleLogger)
    const child = parent.createChild()
    expect(child.has(Logger)).toBe(true)
    expect(child.make(Logger)).toBeInstanceOf(ConsoleLogger)
  })

  it('overrides without affecting the parent', () => {
    const parent = new Container().singleton(Logger, ConsoleLogger)
    const child = parent.createChild().singleton(Logger, TestLogger)
    expect(child.make(Logger)).toBeInstanceOf(TestLogger)
    expect(parent.make(Logger)).toBeInstanceOf(ConsoleLogger)
    child.bind(Clock)
    expect(child.has(Clock)).toBe(true)
    expect(parent.has(Clock)).toBe(false)
  })

  it('shares parent singletons, built with parent bindings', () => {
    class Service {
      constructor(readonly logger: Logger) {}
    }
    const deps = depsOf([[Service, { slots: [() => Logger] }]])
    const parent = new Container({ deps }).bind(Logger, ConsoleLogger).singleton(Service)
    const child = parent.createChild().bind(Logger, TestLogger)
    const service = child.make(Service)
    expect(service).toBe(parent.make(Service))
    expect(service.logger).toBeInstanceOf(ConsoleLogger)
  })

  it('resolves transient parent bindings and autowired classes with child overrides', () => {
    class Service {
      constructor(readonly logger: Logger) {}
    }
    const deps = depsOf([[Service, { slots: [() => Logger] }]])
    const parent = new Container({ deps }).bind(Logger, ConsoleLogger).bind(Service)
    const child = parent.createChild().instance(Logger, new TestLogger())
    expect(child.make(Service).logger).toBeInstanceOf(TestLogger)
    expect(parent.make(Service).logger).toBeInstanceOf(ConsoleLogger)
  })

  it('inherits the deps lookup unless given one', () => {
    class Service {
      constructor(readonly clock: Clock) {}
    }
    const parent = new Container({ deps: depsOf([[Service, { slots: [() => Clock] }]]) })
    expect(parent.createChild().make(Service).clock).toBeInstanceOf(Clock)
    expect(() => parent.createChild({ deps: depsOf([]) }).make(Service)).toThrow(/no dependency metadata/)
  })
})
