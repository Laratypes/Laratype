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

  test('a pattern with "}" before "/" keeps the type wildcard and is refused at runtime too', () => {
    // Hono cannot route this path: it reads the pattern up to the first "}" and splits the route at the "/" after it,
    // so the type's split (which sees the "}" of the quantifier, then the "*" segment) and buildUrl's runtime refusal
    // agree on refusing it instead of building a URL that 404s
    expectTypeOf<UrlParams<'/files/:f{a{2}/*/b}'>>().toEqualTypeOf<{
      readonly error: 'buildUrl: path "/files/:f{a{2}/*/b}" has a "*" segment, which buildUrl cannot fill'
    }>()
    // @ts-expect-error the params type is the wildcard error, so the call is a type error too: buildUrl throws for the path
    buildUrl('/files/:f{a{2}/*/b}', { params: { f: 'aa/b' } })
  })

  test('a pattern Hono cuts at an inner "}" is an error type, like the runtime refusal', () => {
    // the same rule as buildUrl's runtime refusal, in the params type: no keys to fill, since the path cannot be routed
    expectTypeOf<UrlParams<'/files/:f{[a-z]{2}/x}'>>().toEqualTypeOf<{
      readonly error: 'buildUrl: path "/files/:f{[a-z]{2}/x}" has a pattern with "}" before "/", which Hono cannot route'
    }>()
    expectTypeOf<UrlParams<'/files/:f{a{2}/.*/b}'>>().toEqualTypeOf<{
      readonly error: 'buildUrl: path "/files/:f{a{2}/.*/b}" has a pattern with "}" before "/", which Hono cannot route'
    }>()
    // @ts-expect-error the params type is the cut-pattern error, so the call is a type error too
    buildUrl('/files/:f{[a-z]{2}/x}', { params: { f: 'ab' } })
    // braces that close their pattern are still params: a quantifier, a "/" before the inner "}", and a merged pattern
    expectTypeOf<UrlParams<'/files/:f{a{2}}'>>().toEqualTypeOf<{ f: string | number }>()
    expectTypeOf<UrlParams<'/files/:f{[a-z]{2,3}}'>>().toEqualTypeOf<{ f: string | number }>()
    expectTypeOf<UrlParams<'/files/:f{a/b{2}}'>>().toEqualTypeOf<{ f: string | number }>()
    expectTypeOf<UrlParams<'/files/:file{.+/.+}'>>().toEqualTypeOf<{ file: string | number }>()
    // a "}" inside a class is not a nested brace: the path is not cut when no "/" follows it
    expectTypeOf<UrlParams<'/files/:f{[^}]*}'>>().toEqualTypeOf<{ f: string | number }>()
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

  test('a flat named query is accepted, an interface included', () => {
    interface SearchQuery {
      page: number
      q?: string
      tags?: readonly string[]
      // keys that name a member of an array or a function are ordinary query keys
      apply?: string
      length?: number
    }
    type Filters = { on: boolean; at: Date }
    const search: SearchQuery = { page: 1, apply: 'x', length: 2 }
    const filters: Filters = { on: true, at: new Date() }
    expectTypeOf(buildUrl('/users', { query: search })).toEqualTypeOf<string>()
    expectTypeOf(buildUrl('/users', { query: filters })).toEqualTypeOf<string>()
    // an explicit `query: undefined` is the same as omitting it
    expectTypeOf(buildUrl('/users', { query: undefined })).toEqualTypeOf<string>()
    // an optional field absent is still a flat query
    expectTypeOf(buildUrl('/users', { query: { page: 1 } satisfies SearchQuery })).toEqualTypeOf<string>()
    // @ts-expect-error an array is not a query object
    buildUrl('/users', { query: [{ page: 1 }] })
    // @ts-expect-error a function is not a query object
    buildUrl('/users', { query: () => ({ page: 1 }) })
  })

  test('a nested object in a named query is refused: a mapped shape, not an index signature', () => {
    interface NestedQuery {
      filter: { a: number }
    }
    const nested: NestedQuery = { filter: { a: 1 } }
    // @ts-expect-error a nested object has no serialization
    buildUrl('/users', { query: nested })
    interface NestedArrayQuery {
      filters: readonly { a: number }[]
    }
    const nestedArray: NestedArrayQuery = { filters: [{ a: 1 }] }
    // @ts-expect-error an array of objects is not a flat value
    buildUrl('/users', { query: nestedArray })
  })
})
