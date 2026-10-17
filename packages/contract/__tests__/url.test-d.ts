// Type tests for buildUrl (CL1 #109): params are typed from the path.
import { describe, expectTypeOf, test } from 'vitest'
import { buildUrl } from '@laratype/contract'
import type { UrlParams } from '@laratype/contract'

describe('buildUrl', () => {
  test('params follow PathParams, values take a string or a number', () => {
    expectTypeOf<UrlParams<'/users/:user/posts/:post?'>>().toEqualTypeOf<{ user: string | number; post?: string | number }>()
    expectTypeOf<UrlParams<'/health'>>().toEqualTypeOf<{}>()
    expectTypeOf<UrlParams<string>>().toEqualTypeOf<Record<string, string | number>>()
    expectTypeOf(buildUrl('/users/:user', { params: { user: 1 } })).toEqualTypeOf<string>()
  })

  test('the input is optional only when the path has no required param', () => {
    buildUrl('/health')
    buildUrl('/users/:user?')
    buildUrl('/users', { query: { page: 1 } })
    // @ts-expect-error a required param needs the input
    buildUrl('/users/:user')
    // @ts-expect-error a required param cannot be omitted
    buildUrl('/users/:user', { params: {} })
    // @ts-expect-error unknown param
    buildUrl('/users/:user', { params: { user: 1, post: 2 } })
    // @ts-expect-error param values are strings or numbers
    buildUrl('/users/:user', { params: { user: true } })
  })
})
