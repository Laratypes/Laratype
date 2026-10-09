import { describe, expect, it } from 'vitest'
import { PACKAGE_NAME } from '@laratype/contract'

describe('@laratype/contract', () => {
  it('can be imported', () => {
    expect(PACKAGE_NAME).toBe('@laratype/contract')
  })
})
