// Type tests for Request.ip() and the adapter seam (H30 #299): run by `bunx vitest run --project types`.
import { describe, expectTypeOf, test } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { ConnInfo } from 'hono/conninfo'
import { mountConnInfo, Request } from '../../src/index'

describe('Request.ip()', () => {
  test('answers the client address, or undefined when the adapter registered none', () => {
    expectTypeOf(new Request(null as never).ip()).toEqualTypeOf<string | undefined>()
  })
})

describe('mountConnInfo', () => {
  test('takes the Hono app and the runtime getConnInfo', () => {
    const getConnInfo = (c: Context): ConnInfo => ({ remote: { address: c.req.path } })
    expectTypeOf(mountConnInfo).parameter(0).toExtend<Hono>()
    expectTypeOf(mountConnInfo).parameter(1).toEqualTypeOf<typeof getConnInfo>()
    mountConnInfo(new Hono(), getConnInfo)
  })
})
