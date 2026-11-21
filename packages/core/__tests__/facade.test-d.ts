import { describe, expectTypeOf, it } from 'vitest'
import { appContainer, Container, Facade, peekAppContainer, token } from '@laratype/core'

abstract class Greeter {
  abstract greet(name: string): string
}

class Greet extends Facade {
  static override readonly accessor = Greeter
  static greet(name: string) {
    return this.root().greet(name)
  }
}

const SERVER = token<{ port: number }>('server')

class Server extends Facade {
  static override readonly accessor = SERVER
}

/** Type-level checks only: the body is type-checked but never run. */
const typeOnly = (_fn: () => void) => {}

describe('Facade types', () => {
  it('hasFacadeApplication() returns whether one is set', () => {
    typeOnly(() => {
      expectTypeOf(Facade.hasFacadeApplication()).toEqualTypeOf<boolean>()
    })
  })

  it('fake() takes the accessor type and returns a restore function', () => {
    typeOnly(() => {
      expectTypeOf(Greet.fake({ greet: () => 'x' })).toEqualTypeOf<() => void>()
      // @ts-expect-error the fake must implement the accessor type
      Greet.fake({ greet: () => 1 })
      // @ts-expect-error the fake must implement the accessor type
      Greet.fake({})
    })
  })

  it('root() returns the accessor type and is protected', () => {
    expectTypeOf(Greet.greet).returns.toEqualTypeOf<string>()
    typeOnly(() => {
      // @ts-expect-error root() is protected
      Greet.root()
    })
  })

  it('fake() takes a token accessor type', () => {
    typeOnly(() => {
      Server.fake({ port: 8080 })
      // @ts-expect-error a token facade's fake has the token type
      Server.fake({ port: '8080' })
    })
  })
})

describe('Container.swap types', () => {
  const c = new Container()

  it('takes the token type and returns a restore function', () => {
    typeOnly(() => {
      expectTypeOf(c.swap(SERVER, { port: 1 })).toEqualTypeOf<() => void>()
      // @ts-expect-error the value must have the token type
      c.swap(SERVER, { port: '1' })
      // @ts-expect-error the value must be an instance of the class
      c.swap(Greeter, { other: 1 })
    })
  })
})

describe('app container lookup types', () => {
  it('appContainer() returns a Container, peekAppContainer() may return undefined', () => {
    typeOnly(() => {
      expectTypeOf(appContainer()).toEqualTypeOf<Container>()
      expectTypeOf(peekAppContainer()).toEqualTypeOf<Container | undefined>()
    })
  })

  it('reapplyFakes() and confirmFakes() take the boot container', () => {
    typeOnly(() => {
      const app = new Container()
      expectTypeOf(Facade.reapplyFakes(app)).toEqualTypeOf<void>()
      expectTypeOf(Facade.confirmFakes(app)).toEqualTypeOf<void>()
      // @ts-expect-error the boot passes its container
      Facade.reapplyFakes(undefined)
    })
  })
})
