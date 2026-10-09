import { describe, expect, it } from 'vitest'
import { PACKAGE_NAME } from '@laratype/core'

describe('@laratype/core', () => {
  it('can be imported', () => {
    expect(PACKAGE_NAME).toBe('@laratype/core')
  })
})
