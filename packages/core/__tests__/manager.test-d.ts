import { describe, expectTypeOf, it } from 'vitest'
import { Manager } from '@laratype/core'

interface Driver {
  readonly name: string
}

interface MemoryDriver extends Driver {
  readonly lines: string[]
}

class TestManager extends Manager<{ single: Driver; memory: MemoryDriver }, 'single'> {
  protected override get defaultDriver(): 'single' {
    return 'single'
  }

  protected override createDriver(name: 'single' | 'memory'): Driver | MemoryDriver {
    return name === 'single' ? { name } : { name, lines: [] }
  }
}

/** Type-level checks only: the body is type-checked but never run. */
const typeOnly = (_fn: () => void) => {}

describe('Manager types', () => {
  const manager = new TestManager()

  it('types driver() by the default driver and driver(name) by the name', () => {
    expectTypeOf(manager.driver()).toEqualTypeOf<Driver>()
    expectTypeOf(manager.driver('single')).toEqualTypeOf<Driver>()
    expectTypeOf(manager.driver('memory')).toEqualTypeOf<MemoryDriver>()
  })

  it('rejects a driver name the manager does not declare', () => {
    typeOnly(() => {
      // @ts-expect-error "nope" is not a driver name of this manager
      manager.driver('nope')
    })
  })

  it('requires the Drivers map, so no manager widens its names to string', () => {
    typeOnly(() => {
      // @ts-expect-error Manager requires its Drivers map; a manager without one would accept any name
      type Bare = Manager
    })
  })

  it('extend() takes a factory of that driver and returns the manager', () => {
    typeOnly(() => {
      expectTypeOf(manager.extend('memory', () => ({ name: 'memory', lines: [] }))).toEqualTypeOf<TestManager>()
      manager.extend('memory', (m) => {
        expectTypeOf(m).toEqualTypeOf<TestManager>()
        return { name: 'memory', lines: [] }
      })
      // @ts-expect-error the factory must build that driver's type
      manager.extend('memory', () => ({ name: 'memory' }))
      // @ts-expect-error extend() only takes a driver name the manager declares
      manager.extend('nope', () => ({ name: 'nope' }))
    })
  })
})
