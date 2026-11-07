// Type test for the request-scope disposal hook (D6 #112): run by `bunx vitest run --project types`.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from 'vitest'
import { Container, depsRegistry } from '@laratype/core'
import { RequestKernel } from '../../src/index'

describe('RequestKernel.settled', () => {
  test('is the internal hook that awaits the pending request-scope disposals', () => {
    const kernel = new RequestKernel(new Container({ deps: depsRegistry }))
    expectTypeOf(kernel.settled).toBeFunction()
    expectTypeOf(kernel.settled()).toEqualTypeOf<Promise<void>>()
  })
})
