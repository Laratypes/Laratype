import { afterEach, describe, expect, it } from 'vitest'
import { Container, DiError, Facade, token } from '@laratype/core'

abstract class Greeter {
  abstract greet(name: string): string
}

class Hello extends Greeter {
  greet(name: string) {
    return `hello ${name}`
  }
}

class Counter {
  count = 0
  next() {
    return ++this.count
  }
}

class Greet extends Facade {
  static override readonly accessor = Greeter
  static greet(name: string) {
    return this.root().greet(name)
  }
}

class Count extends Facade {
  static override readonly accessor = Counter
  static next() {
    return this.root().next()
  }
}

const NAME = token<{ value: string }>('name')

class Name extends Facade {
  static override readonly accessor = NAME
  static value() {
    return this.root().value
  }
}

const fake = (prefix: string): Greeter => ({ greet: name => `${prefix} ${name}` })

describe('Container.swap', () => {
  it('replaces a binding and restores it', () => {
    const c = new Container().bind(Greeter, Hello)
    const restore = c.swap(Greeter, fake('fake'))
    expect(c.make(Greeter).greet('Ada')).toBe('fake Ada')
    restore()
    expect(c.make(Greeter)).toBeInstanceOf(Hello)
  })

  it('restores a cached singleton as it was', () => {
    const c = new Container().singleton(Counter)
    const counter = c.make(Counter)
    const restore = c.swap(Counter, new Counter())
    expect(c.make(Counter)).not.toBe(counter)
    restore()
    expect(c.make(Counter)).toBe(counter)
  })

  it('removes the binding on restore when there was none, so the class autowires again', () => {
    const c = new Container()
    const restore = c.swap(Counter, Object.assign(new Counter(), { count: 41 }))
    expect(c.make(Counter).next()).toBe(42)
    restore()
    expect(c.has(Counter)).toBe(false)
    expect(c.make(Counter).next()).toBe(1)
  })

  it('shadows a parent binding for the container and its children, without touching the parent', () => {
    const parent = new Container().bind(Greeter, Hello)
    const child = parent.createChild()
    const restore = child.swap(Greeter, fake('child'))
    expect(child.createChild().make(Greeter).greet('Ada')).toBe('child Ada')
    expect(parent.make(Greeter)).toBeInstanceOf(Hello)
    restore()
    expect(child.make(Greeter)).toBeInstanceOf(Hello)
  })

  it('swaps a token', () => {
    const c = new Container().instance(NAME, { value: 'real' })
    const restore = c.swap(NAME, { value: 'fake' })
    expect(c.make(NAME).value).toBe('fake')
    restore()
    expect(c.make(NAME).value).toBe('real')
  })
})

describe('Facade', () => {
  afterEach(() => Facade.setFacadeApplication(undefined))

  it('forwards to the binding of its accessor in the facade application', () => {
    Facade.setFacadeApplication(new Container().bind(Greeter, Hello).instance(NAME, { value: 'app' }))
    expect(Greet.greet('Ada')).toBe('hello Ada')
    expect(Name.value()).toBe('app')
  })

  it('autowires a concrete accessor without a facade application', () => {
    expect(Count.next()).toBe(1)
    expect(Count.next()).toBe(1)
  })

  it('reuses a singleton binding across calls', () => {
    Facade.setFacadeApplication(new Container().singleton(Counter))
    expect(Count.next()).toBe(1)
    expect(Count.next()).toBe(2)
  })

  it('throws the container error when the accessor is not bound', () => {
    Facade.setFacadeApplication(new Container())
    expect(() => Name.value()).toThrow(DiError)
    expect(() => Name.value()).toThrow(/^No binding for InjectionToken\(name\)\./)
  })

  it('sees app.swap() at once, since it resolves on every call', () => {
    const app = new Container().bind(Greeter, Hello)
    Facade.setFacadeApplication(app)
    expect(Greet.greet('Ada')).toBe('hello Ada')
    const restore = app.swap(Greeter, fake('swapped'))
    expect(Greet.greet('Ada')).toBe('swapped Ada')
    restore()
    expect(Greet.greet('Ada')).toBe('hello Ada')
  })

  it('fake() swaps the binding in the facade application and restores it', () => {
    const app = new Container().bind(Greeter, Hello)
    Facade.setFacadeApplication(app)
    const restore = Greet.fake(fake('faked'))
    expect(Greet.greet('Ada')).toBe('faked Ada')
    expect(app.make(Greeter).greet('Ada')).toBe('faked Ada')
    restore()
    expect(Greet.greet('Ada')).toBe('hello Ada')
  })

  it('fake() works without a facade application', () => {
    const restore = Count.fake(Object.assign(new Counter(), { count: 9 }))
    expect(Count.next()).toBe(10)
    restore()
    expect(Count.next()).toBe(1)
  })

  it('throws on a facade without an accessor', () => {
    class Broken extends Facade {}
    expect(() => Broken.fake({})).toThrow('Facade Broken has no accessor.')
  })
})
