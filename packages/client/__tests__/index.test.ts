import { describe, expect, it } from 'vitest'
import { PACKAGE_NAME } from '@laratype/client'

describe('@laratype/client', () => {
  it('can be imported', () => {
    expect(PACKAGE_NAME).toBe('@laratype/client')
  })
})
