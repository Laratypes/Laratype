import { describe, expect, it } from 'vitest'
import { buildUrl } from '@laratype/contract'

describe('buildUrl', () => {
  it('returns a path without params unchanged', () => {
    expect(buildUrl('/api/users')).toBe('/api/users')
    expect(buildUrl('/')).toBe('/')
    expect(buildUrl('/files/*')).toBe('/files/*')
  })

  it('fills params and encodes them with encodeURIComponent', () => {
    expect(buildUrl('/api/users/:user/posts/:post', { params: { user: 1, post: 'a b/c?d' } })).toBe('/api/users/1/posts/a%20b%2Fc%3Fd')
    expect(buildUrl('/api/users/:user', { params: { user: 'é#%' } })).toBe('/api/users/%C3%A9%23%25')
  })

  it('reads the param name of a regex segment, even when the pattern holds "/" or braces', () => {
    expect(buildUrl('/posts/:id{[0-9]+}', { params: { id: 42 } })).toBe('/posts/42')
    expect(buildUrl('/files/:file{.+/.+}/raw', { params: { file: 'a/b' } })).toBe('/files/a%2Fb/raw')
    expect(buildUrl('/codes/:code{[a-z]{2,3}}?', { params: { code: 'en' } })).toBe('/codes/en')
  })

  it('drops an absent optional param with its segment', () => {
    expect(buildUrl('/users/:user/posts/:post?', { params: { user: 'u' } })).toBe('/users/u/posts')
    expect(buildUrl('/users/:user/posts/:post?', { params: { user: 'u', post: 3 } })).toBe('/users/u/posts/3')
    expect(buildUrl('/:lang?', {})).toBe('/')
  })

  it('throws on a missing required param', () => {
    expect(() => buildUrl('/api/users/:user', { params: {} as { user: string } })).toThrow(
      new TypeError('[@laratype/contract] buildUrl: missing param "user" for "/api/users/:user"'),
    )
    expect(() => buildUrl('/api/users/:user', { params: { user: '' } })).toThrow(/missing param "user"/)
  })

  it('rejects a dot-segment param value, which fetch would resolve ("/api/users/.." → "/api")', () => {
    expect(() => buildUrl('/api/users/:user', { params: { user: '..' } })).toThrow(
      new TypeError('[@laratype/contract] buildUrl: param "user" for "/api/users/:user" cannot be ".." (a dot segment)'),
    )
    expect(() => buildUrl('/api/users/:user/posts', { params: { user: '.' } })).toThrow(/param "user" .* cannot be "\." \(a dot segment\)/)
    expect(() => buildUrl('/files/:name?', { params: { name: '..' } })).toThrow(/a dot segment/)
    // only the whole value: dots inside a value are fine
    expect(buildUrl('/files/:name', { params: { name: '...' } })).toBe('/files/...')
    expect(buildUrl('/files/:name', { params: { name: 'a..b' } })).toBe('/files/a..b')
    expect(buildUrl('/files/:name', { params: { name: '../x' } })).toBe('/files/..%2Fx')
  })

  it('rejects a result that URL parsing reads as another host ("/:a?//x" without a)', () => {
    expect(() => buildUrl('/:a?//evil.com/x' as string, {})).toThrow(
      new TypeError('[@laratype/contract] buildUrl: "/:a?//evil.com/x" builds "//evil.com/x", which a URL reads as another host'),
    )
    expect(() => buildUrl('/:a?/\\evil.com' as string, { params: { a: '' } })).toThrow(/which a URL reads as another host/)
    expect(() => buildUrl('/:a?/\t/evil.com' as string, {})).toThrow(/which a URL reads as another host/)
    expect(() => buildUrl('/:a?//__laratype_a__/x' as string, {})).toThrow(/which a URL reads as another host/)
    // scheme-relative: a path against an http base, another host against an https page
    for (const path of ['/:a?http:/evil.com/x', '/:a?http:evil.com/x', '/:a?https:/evil.com/x']) {
      expect(() => buildUrl(path as string, {})).toThrow(/which a URL reads as another host/)
    }
    expect(buildUrl('/:a?//evil.com/x' as string, { params: { a: 't' } })).toBe('/t//evil.com/x')
  })

  it('keeps a ":" that does not start a segment', () => {
    expect(buildUrl('/time/12:30')).toBe('/time/12:30')
  })

  it('serializes the query: skips null/undefined, repeats array keys, sends a Date as ISO 8601', () => {
    const at = new Date('2026-10-14T00:00:00.000Z')
    expect(
      buildUrl('/api/users', { query: { page: 2, q: 'a b&c', tag: ['x', 'y', null], none: undefined, nil: null, on: true, at } }),
    ).toBe('/api/users?page=2&q=a+b%26c&tag=x&tag=y&on=true&at=2026-10-14T00%3A00%3A00.000Z')
    expect(buildUrl('/api/users', { query: {} })).toBe('/api/users')
    expect(buildUrl('/api/users/:user', { params: { user: 7 }, query: { full: 1 } })).toBe('/api/users/7?full=1')
  })

  it('rejects a function or a symbol in the query', () => {
    for (const value of [() => 1, Symbol('x'), [Symbol('y')]]) {
      expect(() => buildUrl('/api/users', { query: { bad: value } })).toThrow(
        new TypeError('[@laratype/contract] buildUrl: query "bad" must be a string, number, boolean, bigint or Date, or an array of them'),
      )
    }
  })

  it('rejects a nested object in the query', () => {
    expect(() => buildUrl('/api/users', { query: { filter: { a: 1 } } })).toThrow(
      new TypeError('[@laratype/contract] buildUrl: query "filter" must be a string, number, boolean, bigint or Date, or an array of them'),
    )
  })
})
