import { describe, expectTypeOf, it } from 'vitest'
import { Container, token } from '@laratype/core'
import type { InjectionToken } from '@laratype/core'

abstract class Logger {
  abstract log(message: string): void
}
class ConsoleLogger extends Logger {
  log() {}
}
class Unrelated {
  other = 1
}

interface Config {
  name: string
}

/** Type-level checks only: the body is type-checked but never run. */
const typeOnly = (_fn: () => void) => {}

describe('typed resolution', () => {
  const c = new Container()

  it('token<T>() carries T to make()', () => {
    const CONFIG = token<Config>('config')
    expectTypeOf(CONFIG).toEqualTypeOf<InjectionToken<Config>>()
    typeOnly(() => {
      expectTypeOf(c.make(CONFIG)).toEqualTypeOf<Config>()
      expectTypeOf(c.make(token<number>('port'))).toEqualTypeOf<number>()
    })
  })

  it('classes resolve to their instance type, abstract included', () => {
    typeOnly(() => {
      expectTypeOf(c.make(ConsoleLogger)).toEqualTypeOf<ConsoleLogger>()
      expectTypeOf(c.make(Logger)).toEqualTypeOf<Logger>()
    })
  })

  it('rejects mismatched bindings', () => {
    const PORT = token<number>('port')
    typeOnly(() => {
      c.bind(Logger, ConsoleLogger)
      c.singleton(Logger, () => new ConsoleLogger())
      c.instance(PORT, 3000)
      // @ts-expect-error Unrelated is not a Logger
      c.bind(Logger, Unrelated)
      // @ts-expect-error factory must return a Logger
      c.transient(Logger, () => new Unrelated())
      // @ts-expect-error value must be a number
      c.instance(PORT, '3000')
      // @ts-expect-error an abstract class can't be bound to itself
      c.singleton(Logger)
      // @ts-expect-error a token can't be bound to itself
      c.bind(PORT)
      // @ts-expect-error tokens are typed apart
      const n: string = c.make(PORT)
      void n
    })
  })

  it('factories receive the container', () => {
    c.bind(Logger, (container) => {
      expectTypeOf(container).toEqualTypeOf<Container>()
      return new ConsoleLogger()
    })
    c.make(Logger)
  })
})
