import { expectTypeOf, it } from 'vitest'
import type { Container } from '@laratype/core'
import { ContextApi } from '@laratype/support'

it('getContainer() always returns a container', () => {
  expectTypeOf(ContextApi.getContainer()).toEqualTypeOf<Container>()
})
