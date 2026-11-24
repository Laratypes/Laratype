// Type tests for Request.ip() and the adapter seam (H30 #299): run by `bunx vitest run --project types`.
import { describe, expectTypeOf, test } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { ConnInfo } from 'hono/conninfo'
import { mountConnInfo, Request } from '../../src/index'

/** Type-level checks only: the body is type-checked but never run. */
const typeOnly = (_fn: () => void) => {}

describe('Request.ip()', () => {
  test('answers the client address, or undefined when the adapter registered none', () => {
    typeOnly(() => {
      expectTypeOf(new Request(null as never).ip()).toEqualTypeOf<string | undefined>()
    })
  })
})

describe('mountConnInfo', () => {
  test('takes the Hono app and the runtime getConnInfo', () => {
    typeOnly(() => {
      const getConnInfo = (c: Context): ConnInfo => ({ remote: { address: c.req.path } })
      expectTypeOf(mountConnInfo).parameter(0).toExtend<Hono>()
      expectTypeOf(mountConnInfo).parameter(1).toEqualTypeOf<typeof getConnInfo>()
      mountConnInfo(new Hono(), getConnInfo)
    })
  })

  test('takes a Hono app with typed bindings, variables and a base path, without a cast', () => {
    typeOnly(() => {
      const getConnInfo = (c: Context): ConnInfo => ({ remote: { address: c.req.path } })
      const app = new Hono<{ Bindings: { tenant: string }, Variables: { user: string } }, {}, '/api'>()
      mountConnInfo(app, getConnInfo)
    })
  })
})
