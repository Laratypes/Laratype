// Type tests: run by `bunx vitest run --project types`.
import { expectTypeOf, test } from 'vitest'
import { isException } from '../src/index'
import type { Exception } from '../src/index'

test('isException narrows an unknown catch value to an Exception', () => {
  const caught: unknown = undefined
  if (isException(caught)) {
    expectTypeOf(caught).toEqualTypeOf<Exception>()
    expectTypeOf(caught.canResponsible()).toEqualTypeOf<boolean>()
  }
  expectTypeOf(isException).parameter(0).toEqualTypeOf<unknown>()
})
