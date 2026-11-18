import { describe, expect, it } from 'vitest'
import { buildUrl } from '@laratype/contract'

describe('buildUrl', () => {
  it('returns a path without params unchanged', () => {
    expect(buildUrl('/api/users')).toBe('/api/users')
    expect(buildUrl('/')).toBe('/')
    // "*" only has a meaning in a whole segment: inside a static one it is a character
    expect(buildUrl('/lit/a*b')).toBe('/lit/a*b')
  })

  it('fills params and encodes them with encodeURIComponent', () => {
    expect(buildUrl('/api/users/:user/posts/:post', { params: { user: 1, post: 'a b/c?d' } })).toBe('/api/users/1/posts/a%20b%2Fc%3Fd')
    expect(buildUrl('/api/users/:user', { params: { user: 'é#%' } })).toBe('/api/users/%C3%A9%23%25')
  })

  it('reads the param name of a regex segment, even when the pattern holds "/" or braces', () => {
    expect(buildUrl('/posts/:id{[0-9]+}', { params: { id: 42 } })).toBe('/posts/42')
    expect(buildUrl('/codes/:code{[a-z]{2,3}}?', { params: { code: 'en' } })).toBe('/codes/en')
    // the "*" of ".*" is part of the pattern, not a wildcard segment
    expect(buildUrl('/files/:file{.*}', { params: { file: 'a b' } })).toBe('/files/a%20b')
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

describe('buildUrl regex params that can match "/"', () => {
  it('keeps the slashes of a pattern that holds one, encoding each segment on its own', () => {
    expect(buildUrl('/files/:file{.+/.+}/raw', { params: { file: 'a/b' } })).toBe('/files/a/b/raw')
    expect(buildUrl('/files/:file{.+/.+}/raw', { params: { file: 'a b/c?d#e%f' } })).toBe('/files/a%20b/c%3Fd%23e%25f/raw')
    expect(buildUrl('/files/:file{.+/.+}/raw', { params: { file: 'a/b/c' } })).toBe('/files/a/b/c/raw')
    expect(buildUrl('/files/:file{.+/.+}/raw', { params: { file: '😀/é' } })).toBe('/files/%F0%9F%98%80/%C3%A9/raw')
  })

  it('reads "." as any character, so a pattern without a literal "/" can match one too', () => {
    expect(buildUrl('/files/:file{.+}', { params: { file: 'a/b' } })).toBe('/files/a/b')
    expect(buildUrl('/files/:file{[^/]+}', { params: { file: 'a/b' } })).toBe('/files/a%2Fb')
    expect(buildUrl('/files/:file{[a-z]+}', { params: { file: 'a/b' } })).toBe('/files/a%2Fb')
  })

  it('keeps "/" encoded for a pattern that cannot match it', () => {
    expect(buildUrl('/posts/:id{[0-9]+}', { params: { id: '1/2' } })).toBe('/posts/1%2F2')
    expect(buildUrl('/codes/:code{[a-z]{2,3}}', { params: { code: 'a/b' } })).toBe('/codes/a%2Fb')
  })

  it('refuses an empty segment, naming the param and the path, never the value', () => {
    const path = '/files/:file{.+/.+}/raw'
    for (const value of ['/a', 'a/', 'a//b', '/', 'a b//c']) {
      let error: unknown
      try {
        buildUrl(path, { params: { file: value } })
      } catch (thrown) {
        error = thrown
      }
      expect(error).toBeInstanceOf(TypeError)
      expect((error as Error).message).toBe(
        '[@laratype/contract] buildUrl: param "file" for "/files/:file{.+/.+}/raw" has an empty segment',
      )
    }
  })

  it('refuses a "." or ".." segment, which URL parsing would resolve, without echoing the value', () => {
    for (const value of ['a/./b', 'a/../b', '../x', 'x/..']) {
      let error: unknown
      try {
        buildUrl('/files/:file{.+/.+}/raw', { params: { file: value } })
      } catch (thrown) {
        error = thrown
      }
      expect(error).toBeInstanceOf(TypeError)
      expect((error as Error).message).toBe(
        '[@laratype/contract] buildUrl: param "file" for "/files/:file{.+/.+}/raw" has a "." or ".." segment (a dot segment)',
      )
      expect((error as Error).message).not.toContain(value)
    }
    // dots inside a segment are kept
    expect(buildUrl('/files/:file{.+/.+}/raw', { params: { file: 'a../.../b' } })).toBe('/files/a../.../b/raw')
  })

  it('refuses an unpaired surrogate through encodeURIComponent, naming the param, never the value', () => {
    for (const value of ['\uD800', 'a/\uDC00b']) {
      let error: unknown
      try {
        buildUrl('/files/:file{.+/.+}/raw', { params: { file: value } })
      } catch (thrown) {
        error = thrown
      }
      expect(error).toBeInstanceOf(TypeError)
      expect((error as Error).message).toBe(
        '[@laratype/contract] buildUrl: param "file" for "/files/:file{.+/.+}/raw" has an unpaired surrogate',
      )
      expect((error as Error).message).not.toContain('ud800')
      expect((error as Error).message).not.toContain('udc00')
    }
  })
})

describe('buildUrl wildcard segments', () => {
  it('refuses a "*" segment at runtime, naming the path', () => {
    for (const path of ['/files/*', '*', '/*', '/files/*/x', '/api/users/:user/files/*']) {
      expect(() => buildUrl(path as string, { params: { user: 1 } } as never)).toThrow(
        new TypeError(`[@laratype/contract] buildUrl: path "${path}" has a "*" segment, which buildUrl cannot fill`),
      )
    }
  })

  it('does not read a "*" of a regex pattern or of a longer segment as a wildcard', () => {
    expect(buildUrl('/files/:file{.*}', { params: { file: 'a/b' } })).toBe('/files/a/b')
    expect(buildUrl('/files/:file{.+/*}', { params: { file: 'a/x' } })).toBe('/files/a/x')
    expect(buildUrl('/lit/a*b')).toBe('/lit/a*b')
  })
})

describe('buildUrl edge inputs', () => {
  it('needs a string path, and never reads its length', () => {
    let reads = 0
    const value = {
      get length() {
        reads += 1
        return 1e9
      },
    }
    const cases = [42, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, value, Symbol('path'), true, 1n, () => '/x']
    for (const path of cases) {
      expect(() => buildUrl(path as never)).toThrow(
        new TypeError(`[@laratype/contract] buildUrl: path must be a string, got ${typeof path}`),
      )
    }
    expect(reads).toBe(0)
  })

  it('needs an object for params and query, null and undefined meaning none', () => {
    expect(buildUrl('/health', { params: null as never, query: null as never })).toBe('/health')
    expect(buildUrl('/health', { params: undefined, query: undefined })).toBe('/health')
    for (const value of [42, Number.NaN, 'x', Symbol('x'), true, 1n, () => ({})]) {
      expect(() => buildUrl('/health', { params: value as never })).toThrow(
        new TypeError(`[@laratype/contract] buildUrl: params must be an object, got ${typeof value}`),
      )
      expect(() => buildUrl('/health', { query: value as never })).toThrow(
        new TypeError(`[@laratype/contract] buildUrl: query must be an object, got ${typeof value}`),
      )
    }
  })

  it('needs a string or a number as a param value, naming only its type', () => {
    for (const value of [{ a: 1 }, { length: 1e9 }, Symbol('x'), () => 1, true, 1n]) {
      let error: unknown
      try {
        buildUrl('/users/:user', { params: { user: value as never } })
      } catch (thrown) {
        error = thrown
      }
      expect(error).toBeInstanceOf(TypeError)
      expect((error as Error).message).toBe(
        `[@laratype/contract] buildUrl: param "user" for "/users/:user" must be a string or a number, got ${typeof value}`,
      )
    }
    // a number is not read as a length anywhere: NaN and Infinity reach the path as their text
    expect(buildUrl('/users/:user', { params: { user: Number.NaN } })).toBe('/users/NaN')
    expect(buildUrl('/users/:user', { params: { user: Number.POSITIVE_INFINITY } })).toBe('/users/Infinity')
  })

  it('reads only own param keys, so a prototype value is not a param', () => {
    const params = Object.create({ user: 'ada' }) as { user: string }
    expect(() => buildUrl('/users/:user', { params })).toThrow(/missing param "user"/)
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(() => buildUrl(`/users/:${name}` as string, { params: {} })).toThrow(
        new TypeError(`[@laratype/contract] buildUrl: missing param "${name}" for "/users/:${name}"`),
      )
    }
    // an own "__proto__" key (JSON.parse creates one) is a value, and is forwarded as a normal key
    const parsed = JSON.parse('{"__proto__":"x","constructor":"y"}') as Record<string, string>
    expect(buildUrl('/p/:__proto__/:constructor' as string, { params: parsed })).toBe('/p/x/y')
  })

  it('keeps a non-enumerable own param, control characters and 1 MB values', () => {
    const params = {}
    Object.defineProperty(params, 'user', { value: 'ada', enumerable: false })
    expect(buildUrl('/users/:user', { params: params as { user: string } })).toBe('/users/ada')
    expect(buildUrl('/users/:user', { params: { user: 'a\u0000b\tc\nd' } })).toBe('/users/a%00b%09c%0Ad')
    const big = 'a'.repeat(1_000_000)
    expect(buildUrl('/users/:user', { params: { user: big } })).toBe(`/users/${big}`)
  })

  it('serializes query keys as plain own enumerable keys, "__proto__" included', () => {
    const parsed = JSON.parse('{"__proto__":"x","constructor":"y"}') as object
    expect(buildUrl('/x', { query: parsed })).toBe('/x?__proto__=x&constructor=y')
    const inherited = Object.create({ page: 1 }) as { page: number }
    expect(buildUrl('/x', { query: inherited })).toBe('/x')
    const hidden = {}
    Object.defineProperty(hidden, 'page', { value: 1, enumerable: false })
    expect(buildUrl('/x', { query: hidden })).toBe('/x')
    // a query value named "length" is a value, never a length to read
    expect(buildUrl('/x', { query: { length: 1e9 } })).toBe('/x?length=1000000000')
  })

  it('serializes NaN, Infinity, bigint, control characters and 1 MB query values', () => {
    const big = 'b'.repeat(1_000_000)
    expect(buildUrl('/x', { query: { nan: Number.NaN, inf: Number.POSITIVE_INFINITY, big: 9007199254740993n, ctl: 'a\u0000b', text: big } })).toBe(
      `/x?nan=NaN&inf=Infinity&big=9007199254740993&ctl=a%00b&text=${big}`,
    )
  })

  it('replaces an unpaired surrogate in a query value with U+FFFD, as URLSearchParams does', () => {
    expect(buildUrl('/x', { query: { q: '\uD800', tag: ['a\uDC00b'] } })).toBe('/x?q=%EF%BF%BD&tag=a%EF%BF%BDb')
  })

  it('rejects a nested object query value of any shape before reading it', () => {
    const value = {
      toString() {
        throw new Error('toString ran')
      },
    }
    expect(() => buildUrl('/x', { query: { filter: value } })).toThrow(
      new TypeError('[@laratype/contract] buildUrl: query "filter" must be a string, number, boolean, bigint or Date, or an array of them'),
    )
    expect(() => buildUrl('/x', { query: { filter: [{ a: 1 }] } })).toThrow(/query "filter" must be/)
    // a { length: 1e9 } object is a value, never a length to read
    expect(() => buildUrl('/x', { query: { filter: { length: 1e9 } } })).toThrow(/query "filter" must be/)
  })
})
