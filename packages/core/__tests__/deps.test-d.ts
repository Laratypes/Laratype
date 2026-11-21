import { describe, expectTypeOf, it } from 'vitest'
import { depsRegistry } from '@laratype/core'
import type { DepsEntry, DepsLookup } from '@laratype/core'

describe('DepsLookup.hasOwn', () => {
  it('is an optional boolean ownership signal', () => {
    expectTypeOf<DepsLookup['hasOwn']>().toEqualTypeOf<((cls: Function) => boolean) | undefined>()
    const withOwn: DepsLookup = { get: () => undefined, hasOwn: (cls) => cls.name.length > 0 }
    expectTypeOf(withOwn.hasOwn).toEqualTypeOf<((cls: Function) => boolean) | undefined>()
    // A Map/WeakMap stays a lookup without the optional methods.
    expectTypeOf(new Map<Function, DepsEntry>()).toMatchTypeOf<DepsLookup>()
    // @ts-expect-error hasOwn must return a boolean
    const bad: DepsLookup = { get: () => undefined, hasOwn: () => 'no' }
    void bad
  })

  it('depsRegistry exposes the ownership methods without optional chaining', () => {
    expectTypeOf(depsRegistry.hasOwn).toEqualTypeOf<(cls: Function) => boolean>()
    expectTypeOf(depsRegistry.getWithOwner).toEqualTypeOf<(cls: Function) => { entry: DepsEntry, owner: Function } | undefined>()
    expectTypeOf(depsRegistry.hasOwn(class {})).toEqualTypeOf<boolean>()
  })
})
