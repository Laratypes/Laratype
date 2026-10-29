import { afterEach, describe, expect, it, vi } from 'vitest'
import { Container, Facade, Manager } from '@laratype/core'

class Driver {
  constructor(readonly name: string) {}
}

type Name = 'single' | 'memory' | 'custom'

class TestManager extends Manager<Record<Name, Driver>, Name> {
  /** The names `createDriver()` was asked for, in order. */
  readonly created: Name[] = []
  defaultName: Name = 'single'

  protected override get defaultDriver(): Name {
    return this.defaultName
  }

  protected override createDriver(name: Name): Driver {
    this.created.push(name)
    if (name === 'custom') throw new Error(`[@laratype/core] unknown driver "${name}"`)
    return new Driver(name)
  }
}

/** A service without a configured default: `driver()` throws, a named driver still resolves. */
class NoDefaultManager extends Manager<{ single: Driver }, 'single'> {
  protected override get defaultDriver(): 'single' {
    throw new Error('[@laratype/core] no default driver configured')
  }

  protected override createDriver(name: 'single'): Driver {
    return new Driver(name)
  }
}

class DriverFacade extends Facade {
  static override readonly accessor = TestManager
  static driver(name?: Name) {
    return DriverFacade.root().driver(name)
  }
}

describe('Manager', () => {
  it('resolves the default driver when called without a name', () => {
    const manager = new TestManager()
    expect(manager.driver().name).toBe('single')
    expect(manager.created).toEqual(['single'])
  })

  it('builds each driver once and caches it by name', () => {
    const manager = new TestManager()
    const single = manager.driver('single')
    const memory = manager.driver('memory')
    expect(manager.driver()).toBe(single)
    expect(manager.driver('single')).toBe(single)
    expect(manager.driver('memory')).toBe(memory)
    expect(single).not.toBe(memory)
    expect(manager.created).toEqual(['single', 'memory'])
  })

  it('follows the configured default driver on a later call', () => {
    const manager = new TestManager()
    const single = manager.driver()
    manager.defaultName = 'memory'
    expect(manager.driver()).toBe(manager.driver('memory'))
    expect(manager.driver()).not.toBe(single)
  })

  it('extend() replaces the factory of a resolved driver', () => {
    const manager = new TestManager()
    const original = manager.driver('single')
    const extended = new Driver('extended')
    const factory = vi.fn(() => extended)
    expect(manager.extend('single', factory)).toBe(manager)
    expect(manager.driver('single')).toBe(extended)
    expect(manager.driver('single')).toBe(extended)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(original).not.toBe(extended)
    // createDriver() was not asked again: the factory is what the manager builds from then on
    expect(manager.created).toEqual(['single'])
  })

  it('extend() wins before the first resolution and receives the manager', () => {
    const manager = new TestManager()
    let seen: TestManager | undefined
    manager.extend('memory', (m) => {
      seen = m
      return new Driver('custom memory')
    })
    expect(manager.driver('memory').name).toBe('custom memory')
    expect(seen).toBe(manager)
    expect(manager.created).toEqual([])
  })

  it('extend() drops only the named driver from the cache', () => {
    const manager = new TestManager()
    const single = manager.driver('single')
    const memory = manager.driver('memory')
    manager.extend('memory', () => new Driver('extended memory'))
    expect(manager.driver('single')).toBe(single)
    expect(manager.driver('memory')).not.toBe(memory)
  })

  it('does not cache a driver that createDriver() rejects', () => {
    const manager = new TestManager()
    expect(() => manager.driver('custom')).toThrow('unknown driver "custom"')
    expect(() => manager.driver('custom')).toThrow('unknown driver "custom"')
    expect(manager.created).toEqual(['custom', 'custom'])
  })

  it('propagates the service error when it has no default driver', () => {
    const manager = new NoDefaultManager()
    expect(() => manager.driver()).toThrow('no default driver configured')
    expect(manager.driver('single').name).toBe('single')
  })
})

describe('Manager facades', () => {
  afterEach(() => Facade.setFacadeApplication(undefined))

  it('forwards to a manager bound as a singleton, cache included', () => {
    Facade.setFacadeApplication(new Container().singleton(TestManager))
    expect(DriverFacade.driver()).toBe(DriverFacade.driver('single'))
    expect(DriverFacade.driver('memory')).not.toBe(DriverFacade.driver('single'))
  })

  it('fake() replaces the manager and restore() puts the bound one back', () => {
    const app = new Container().singleton(TestManager)
    Facade.setFacadeApplication(app)
    const bound = app.make(TestManager)
    const fake = new TestManager()
    fake.extend('single', () => new Driver('fake'))
    const restore = DriverFacade.fake(fake)
    expect(DriverFacade.driver('single').name).toBe('fake')
    expect(DriverFacade.driver('single')).toBe(fake.driver('single'))
    restore()
    expect(DriverFacade.driver('single')).toBe(bound.driver('single'))
  })
})
