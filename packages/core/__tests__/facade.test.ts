import { afterEach, describe, expect, it, vi } from 'vitest'
import { appContainer, Container, DiError, Facade, peekAppContainer, token } from '@laratype/core'

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

  it('restore leaves a binding made after the swap in place', () => {
    const c = new Container()
    const restore = c.swap(Greeter, fake('fake'))
    c.bind(Greeter, Hello)
    restore()
    expect(c.make(Greeter)).toBeInstanceOf(Hello)
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

  it('reports whether a facade application is set', () => {
    expect(Facade.hasFacadeApplication()).toBe(false)
    const app = new Container()
    Facade.setFacadeApplication(app)
    expect(Facade.hasFacadeApplication()).toBe(true)
    Facade.setFacadeApplication(undefined)
    expect(Facade.hasFacadeApplication()).toBe(false)
  })

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

  it('setFacadeApplication() drops the fallback container and its fakes', () => {
    const fallback = Facade.getFacadeApplication()
    Count.fake(Object.assign(new Counter(), { count: 9 }))
    Facade.setFacadeApplication(undefined)
    expect(Facade.getFacadeApplication()).not.toBe(fallback)
    expect(Count.next()).toBe(1)
  })

  it('throws on a facade without an accessor', () => {
    class Broken extends Facade {}
    expect(() => Broken.fake({})).toThrow('Facade Broken has no accessor.')
  })
})

describe('appContainer', () => {
  const FALLBACK_WARNED = Symbol.for('laratype.di.fallbackWarned')

  afterEach(() => {
    Facade.setFacadeApplication(undefined)
    delete (globalThis as { [FALLBACK_WARNED]?: true })[FALLBACK_WARNED]
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns the container set by setFacadeApplication(), and peek() never allocates a fallback', () => {
    expect(peekAppContainer()).toBeUndefined()
    const app = new Container()
    Facade.setFacadeApplication(app)
    expect(appContainer()).toBe(app)
    expect(peekAppContainer()).toBe(app)
    expect(Facade.getFacadeApplication()).toBe(app)
  })

  it('creates one shared fallback on first use and warns once in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('__PROD__', false)
    const fallback = appContainer()
    expect(fallback).toBeInstanceOf(Container)
    expect(peekAppContainer()).toBe(fallback)
    expect(appContainer()).toBe(fallback)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('No app container')
  })

  it('does not warn in production', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('__PROD__', true)
    appContainer()
    expect(warn).not.toHaveBeenCalled()
  })

  it('treats null and undefined as unset', () => {
    Facade.setFacadeApplication(new Container())
    expect(Facade.hasFacadeApplication()).toBe(true)
    Facade.setFacadeApplication(null as unknown as undefined)
    expect(Facade.hasFacadeApplication()).toBe(false)
    expect(peekAppContainer()).toBeUndefined()
    Facade.setFacadeApplication(undefined)
    expect(Facade.hasFacadeApplication()).toBe(false)
  })

  it('treats a falsy non-container number as unset and a truthy one as a failing application', () => {
    Facade.setFacadeApplication(0 as unknown as Container)
    expect(Facade.hasFacadeApplication()).toBe(false)
    Facade.setFacadeApplication(Number.NaN as unknown as Container)
    expect(Facade.hasFacadeApplication()).toBe(false)
    Facade.setFacadeApplication(1 as unknown as Container)
    expect(peekAppContainer()).toBe(1)
    expect(Facade.hasFacadeApplication()).toBe(true)
    expect(() => Count.fake(new Counter())).toThrow(TypeError)
    Facade.setFacadeApplication(Number.POSITIVE_INFINITY as unknown as Container)
    expect(peekAppContainer()).toBe(Number.POSITIVE_INFINITY)
    Facade.setFacadeApplication(undefined)
    expect(peekAppContainer()).toBeUndefined()
  })

  it('does not validate or read the container it is given: a wrong object fails on use, not on set', () => {
    const wrong = {} as Container
    Facade.setFacadeApplication(wrong)
    expect(peekAppContainer()).toBe(wrong)
    expect(Facade.hasFacadeApplication()).toBe(true)
    expect(() => Count.fake(new Counter())).toThrow(TypeError)
  })

  it('sets a proxy container without reading it, so a throwing get trap is never hit', () => {
    const proxy = new Proxy({}, { get: () => { throw new Error('the container was read') } }) as unknown as Container
    Facade.setFacadeApplication(proxy)
    expect(peekAppContainer()).toBe(proxy)
    expect(Facade.hasFacadeApplication()).toBe(true)
    expect(appContainer()).toBe(proxy)
  })

  it('keeps one app or one fallback across repeated set/clear calls', () => {
    vi.stubGlobal('__PROD__', true)
    const first = appContainer()
    Facade.setFacadeApplication(new Container())
    Facade.setFacadeApplication(undefined)
    expect(peekAppContainer()).toBeUndefined()
    const second = appContainer()
    expect(second).not.toBe(first)
    expect(appContainer()).toBe(second)
  })
})

describe('setFacadeApplication() carry-over', () => {
  afterEach(() => {
    Facade.setFacadeApplication(undefined)
    vi.unstubAllGlobals()
  })

  it('carries a swap made in the fallback into the app container', () => {
    vi.stubGlobal('__PROD__', true)
    const restore = Count.fake(Object.assign(new Counter(), { count: 9 }))
    const app = new Container()
    Facade.setFacadeApplication(app)
    expect(app.make(Counter).next()).toBe(10)
    expect(Count.next()).toBe(11)
    restore()
    // the undo carried with the swap removes the app container's instance too
    expect(app.has(Counter)).toBe(false)
    expect(Count.next()).toBe(1)
  })

  it('does not carry a swap restored before the app container is set', () => {
    vi.stubGlobal('__PROD__', true)
    const restore = Count.fake(Object.assign(new Counter(), { count: 9 }))
    restore()
    const app = new Container()
    Facade.setFacadeApplication(app)
    expect(app.has(Counter)).toBe(false)
    expect(Count.next()).toBe(1)
  })

  it('keeps the app container binding over a fallback swap', () => {
    vi.stubGlobal('__PROD__', true)
    const restore = Count.fake(Object.assign(new Counter(), { count: 9 }))
    const bound = new Counter()
    const app = new Container().instance(Counter, bound)
    Facade.setFacadeApplication(app)
    expect(app.make(Counter)).toBe(bound)
    restore()
  })

  it('does not carry a swap a later bind on the fallback superseded', () => {
    vi.stubGlobal('__PROD__', true)
    const restore = Count.fake(Object.assign(new Counter(), { count: 9 }))
    Facade.getFacadeApplication().instance(Counter, new Counter())
    const app = new Container()
    Facade.setFacadeApplication(app)
    expect(app.has(Counter)).toBe(false)
    restore()
  })

  it('carries the outer fake when nested fakes are restored before the app container is set', () => {
    vi.stubGlobal('__PROD__', true)
    const outer = Count.fake(Object.assign(new Counter(), { count: 9 }))
    const inner = Count.fake(Object.assign(new Counter(), { count: 19 }))
    inner()
    const app = new Container()
    Facade.setFacadeApplication(app)
    expect(Count.next()).toBe(10)
    outer()
    expect(Count.next()).toBe(1)
  })

  it('a restore after the app container is set reinstates the outer fake in the app', () => {
    vi.stubGlobal('__PROD__', true)
    const outer = Count.fake(Object.assign(new Counter(), { count: 9 }))
    const inner = Count.fake(Object.assign(new Counter(), { count: 19 }))
    const app = new Container()
    Facade.setFacadeApplication(app)
    expect(Count.next()).toBe(20)
    inner()
    expect(Count.next()).toBe(10)
    outer()
    expect(Count.next()).toBe(1)
  })

  it('leaves the fallback and its fake in place when the new container throws before it is committed', () => {
    vi.stubGlobal('__PROD__', true)
    const restore = Count.fake(Object.assign(new Counter(), { count: 9 }))
    const throwing = new Proxy({}, { get: () => { throw new Error('the container was read') } }) as unknown as Container
    expect(() => Facade.setFacadeApplication(throwing)).toThrow('the container was read')
    expect(Facade.hasFacadeApplication()).toBe(false)
    expect(Count.next()).toBe(10)
    restore()
  })

  it('gives an unconfirmed application unset the fallback back', () => {
    vi.stubGlobal('__PROD__', true)
    const restore = Count.fake(Object.assign(new Counter(), { count: 9 }))
    Facade.setFacadeApplication(new Container())
    Facade.setFacadeApplication(undefined)
    // The app was never confirmed by a boot: the fake is still the fallback's
    expect(Count.next()).toBe(10)
    restore()
  })
})
