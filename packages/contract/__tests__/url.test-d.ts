// Type tests for buildUrl (CL1 #109): params are typed from the path, the query takes flat values only.
import { describe, expectTypeOf, test } from 'vitest'
import { buildUrl } from '@laratype/contract'
import type { UrlParams, UrlQuery, UrlQueryValue } from '@laratype/contract'

describe('buildUrl', () => {
  test('params follow PathParams, values take a string or a number', () => {
    expectTypeOf<UrlParams<'/users/:user/posts/:post?'>>().toEqualTypeOf<{ user: string | number; post?: string | number }>()
    expectTypeOf<UrlParams<'/health'>>().toEqualTypeOf<{}>()
    expectTypeOf<UrlParams<string>>().toEqualTypeOf<Record<string, string | number>>()
    expectTypeOf(buildUrl('/users/:user', { params: { user: 1 } })).toEqualTypeOf<string>()
  })

  test('a regex segment keeps its param name, whatever the pattern holds', () => {
    expectTypeOf<UrlParams<'/files/:file{.+/.+}/raw'>>().toEqualTypeOf<{ file: string | number }>()
    expectTypeOf<UrlParams<'/posts/:id{[0-9]+}'>>().toEqualTypeOf<{ id: string | number }>()
    expectTypeOf<UrlParams<'/codes/:code{[a-z]{2,3}}?'>>().toEqualTypeOf<{ code?: string | number }>()
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

  test('a path with a "*" segment is an error in params, and is never optional', () => {
    expectTypeOf<UrlParams<'/files/*'>>().toEqualTypeOf<{
      readonly error: 'buildUrl: path "/files/*" has a "*" segment, which buildUrl cannot fill'
    }>()
    // @ts-expect-error a wildcard path cannot be built, even without params
    buildUrl('/files/*')
    // @ts-expect-error a wildcard path has no params to fill
    buildUrl('/files/*', { params: {} })
    // @ts-expect-error a wildcard next to a path param is not a param either
    buildUrl('/users/:user/files/*', { params: { user: 1 } })
    // a "*" inside a regex pattern is not a wildcard segment
    expectTypeOf(buildUrl('/files/:file{.*}', { params: { file: 'a' } })).toEqualTypeOf<string>()
  })

  test('query values are flat: primitives, a Date, null/undefined, or an array of them', () => {
    expectTypeOf<UrlQueryValue>().toEqualTypeOf<string | number | bigint | boolean | Date | null | undefined>()
    expectTypeOf<UrlQuery>().toEqualTypeOf<{ readonly [key: string]: UrlQueryValue | readonly UrlQueryValue[] }>()
    expectTypeOf(
      buildUrl('/users', {
        query: { page: 1, q: 'x', on: true, big: 1n, at: new Date(), none: null, missing: undefined, tags: ['a', 'b'] },
      }),
    ).toEqualTypeOf<string>()
    // @ts-expect-error a nested object has no serialization
    buildUrl('/users', { query: { filter: { a: 1 } } })
    // @ts-expect-error an array of objects is not a flat value
    buildUrl('/users', { query: { filters: [{ a: 1 }] } })
    // @ts-expect-error a Map is an object, not a flat value
    buildUrl('/users', { query: { where: new Map() } })
    // @ts-expect-error a function is not a flat value
    buildUrl('/users', { query: { f: () => 1 } })
    // @ts-expect-error a symbol is not a flat value
    buildUrl('/users', { query: { s: Symbol('x') } })
    // @ts-expect-error the query is an object of keys
    buildUrl('/users', { query: 'page=1' })
  })
})
