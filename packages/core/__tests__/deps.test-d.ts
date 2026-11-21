import { describe, expectTypeOf, it } from 'vitest'
import type { DepsEntry, DepsLookup } from '@laratype/core'

describe('DepsLookup.hasOwn', () => {
  it('is an optional boolean ownership signal', () => {
    expectTypeOf<DepsLookup['hasOwn']>().toEqualTypeOf<((cls: Function) => boolean) | undefined>()
    const withOwn: DepsLookup = { get: () => undefined, hasOwn: (cls) => cls.name.length > 0 }
    expectTypeOf(withOwn.hasOwn).toEqualTypeOf<((cls: Function) => boolean) | undefined>()
    // A Map/WeakMap stays a lookup without the optional method.
    expectTypeOf(new Map<Function, DepsEntry>()).toMatchTypeOf<DepsLookup>()
    // @ts-expect-error hasOwn must return a boolean
    const bad: DepsLookup = { get: () => undefined, hasOwn: () => 'no' }
    void bad
  })
})
