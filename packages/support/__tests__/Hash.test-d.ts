// Type tests for the Hash facade (D8 #115): each Hasher method is on Hash with the same signature
import { describe, expectTypeOf, it } from 'vitest'
import { Hash, Hasher } from '@laratype/support'

describe('Hash facade types', () => {
  it('forwards each Hasher method with the same signature', () => {
    expectTypeOf(Hash.make).toEqualTypeOf<(value: string) => string>()
    expectTypeOf(Hash.check).toEqualTypeOf<(value: string, hashed: string) => boolean>()
    expectTypeOf(Hash.needsRehash).toEqualTypeOf<(hashed: string) => boolean>()
    expectTypeOf(Hash.isHashed).toEqualTypeOf<(value: string) => boolean>()
  })

  it('takes a Hasher instance as its fake, not a partial implementation', () => {
    expectTypeOf(Hash.fake(new Hasher())).toEqualTypeOf<() => void>()
    // @ts-expect-error the fake must implement every Hasher method
    Hash.fake({ make: (value: string) => value })
  })
})
