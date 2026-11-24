import { runInNewContext } from 'node:vm'
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

  it('rejects a query that is not a plain object, while an array stays a valid query value', () => {
    class Filters {
      page = 1
    }
    const values: readonly (readonly [unknown, string])[] = [
      [[], 'Array'],
      [['a'], 'Array'],
      [new Map(), 'Map'],
      [new URLSearchParams(), 'URLSearchParams'],
      [new Date(), 'Date'],
      [new Filters(), 'Filters'],
    ]
    for (const [query, kind] of values) {
      expect(() => buildUrl('/x', { query: query as never })).toThrow(
        new TypeError(`[@laratype/contract] buildUrl: query must be a plain object of keys, got ${kind}`),
      )
    }
    // a proxy that throws on getPrototypeOf is refused with the package's TypeError too, never its own error
    const hostile = new Proxy({}, { getPrototypeOf: () => { throw new Error('getPrototypeOf ran') } })
    expect(() => buildUrl('/x', { query: hostile as never })).toThrow(
      new TypeError('[@laratype/contract] buildUrl: query must be a plain object of keys, got an object'),
    )
    // a plain object from another realm (a vm context) is a plain object too
    const foreign = runInNewContext('({ page: 1 })') as { page: number }
    expect(buildUrl('/x', { query: foreign })).toBe('/x?page=1')
    // a null-prototype object is a plain object of keys
    const bare = Object.create(null) as { page: number }
    bare.page = 1
    expect(buildUrl('/x', { query: bare })).toBe('/x?page=1')
    expect(buildUrl('/x', { query: { tag: ['a', 'b'], none: [] } })).toBe('/x?tag=a&tag=b')
  })
})

describe('buildUrl regex params and "/"', () => {
  it('keeps the slashes of a pattern that holds one, encoding each segment on its own', () => {
    expect(buildUrl('/files/:file{.+/.+}/raw', { params: { file: 'a/b' } })).toBe('/files/a/b/raw')
    expect(buildUrl('/files/:file{.+/.+}/raw', { params: { file: 'a b/c?d#e%f' } })).toBe('/files/a%20b/c%3Fd%23e%25f/raw')
    expect(buildUrl('/files/:file{.+/.+}/raw', { params: { file: 'a/b/c' } })).toBe('/files/a/b/c/raw')
    expect(buildUrl('/files/:file{.+/.+}/raw', { params: { file: '😀/é' } })).toBe('/files/%F0%9F%98%80/%C3%A9/raw')
  })

  it('keeps "/" encoded when the pattern matches the encoded value, so a value cannot pick another route', () => {
    // "." and "[^]" match every character, so ".+", ".*" and "[^]+" accept the encoded value: the slashes stay %2F
    expect(buildUrl('/files/:file{.+}', { params: { file: 'a/b' } })).toBe('/files/a%2Fb')
    expect(buildUrl('/files/:file{.+}', { params: { file: 'admin/all' } })).toBe('/files/admin%2Fall')
    expect(buildUrl('/files/:file{.*}', { params: { file: 'a/b' } })).toBe('/files/a%2Fb')
    expect(buildUrl('/files/:file{[^]+}', { params: { file: 'a/b' } })).toBe('/files/a%2Fb')
    expect(buildUrl('/files/:file{[^.]+}', { params: { file: 'a/b' } })).toBe('/files/a%2Fb')
  })

  it('throws when a top-level "|" would route a split differently under Hono\'s two routers', () => {
    // SmartRouter picks one router for the whole app: the RegExp router scopes a top-level "|" to the param, while the
    // trie router matches it bare and reads only the prefix. Only a split that buildUrl would send is checked: a value
    // without a "/" is the encoded value, and a value whose split the pattern rejects keeps the encoded one
    const path = '/files/:file{a|.+/.+}'
    const expected = `[@laratype/contract] buildUrl: param "file" for "${path}" has a pattern Hono's two routers read differently for this value, so the URL depends on the app's router`
    for (const file of ['admin/all', 'admin/x', 'a/b']) {
      expect(() => buildUrl(path, { params: { file } })).toThrow(new TypeError(expected))
    }
    // values both forms read the same way still build: "a" is the first alternative whole, "x/y" needs the literal "/"
    expect(buildUrl(path, { params: { file: 'a' } })).toBe('/files/a')
    expect(buildUrl(path, { params: { file: 'x/y' } })).toBe('/files/x/y')
    // without a "/" there is no split to send: the encoded value is kept, the trie prefix read is Hono's matching
    expect(buildUrl(path, { params: { file: 'admin' } })).toBe('/files/admin')
    // the same rule with a following static segment: the trie's first alternative would stop at the prefix
    const rawPath = '/files/:file{a|.+/.+}/raw'
    const rawExpected = `[@laratype/contract] buildUrl: param "file" for "${rawPath}" has a pattern Hono's two routers read differently for this value, so the URL depends on the app's router`
    expect(() => buildUrl(rawPath, { params: { file: 'admin/all' } })).toThrow(new TypeError(rawExpected))
    expect(buildUrl(rawPath, { params: { file: 'x/y' } })).toBe('/files/x/y/raw')
  })

  it('keeps the encoded value when no split is sent, even where the trie form would read a prefix', () => {
    // a common alternation pattern: the trie form matches "english" as "en" and "xfr" as the suffix "fr", but the
    // encoded value is what buildUrl sends and what the app's router does with it is not a URL choice
    expect(buildUrl('/:lang{en|fr}', { params: { lang: 'en' } })).toBe('/en')
    expect(buildUrl('/:lang{en|fr}', { params: { lang: 'english' } })).toBe('/english')
    expect(buildUrl('/:lang{en|fr}', { params: { lang: 'xfr' } })).toBe('/xfr')
    expect(buildUrl('/:lang{en|fr}/docs', { params: { lang: 'xfr' } })).toBe('/xfr/docs')
  })

  it('checks only the split that is sent, not the encoded value', () => {
    // the encoded `a%2Fb` is read as the suffix "b" by the trie form, but the split `a/b` is read whole by both forms,
    // so buildUrl sends it: comparing the encoded value too would refuse a URL both routers route correctly
    expect(buildUrl('/files/:f{.+/.+|b}', { params: { f: 'a/b' } })).toBe('/files/a/b')
  })

  it('falls back to the trie form only for a pattern the RegExp router refuses', () => {
    // a capturing group that is not the whole pattern makes Hono's RegExp router throw UnsupportedPathError, so the
    // trie router serves the route; its bare form matches the "a" prefix of the encoded value, the URL it reads
    expect(buildUrl('/files/:file{(a)|.+/.+}', { params: { file: 'admin/all' } })).toBe('/files/admin%2Fall')
    // `.*` is refused by the RegExp router too; both forms accept anything, so the encoded value is kept
    expect(buildUrl('/files/:file{.*}', { params: { file: 'a/b' } })).toBe('/files/a%2Fb')
  })

  it('splits only when the pattern needs a literal "/": the encoded value would not match it', () => {
    // a "/" in a class is a literal too: the encoded value ("%" is not in the class) does not match, the split does
    expect(buildUrl('/files/:file{[a-z/]+}', { params: { file: 'a/b' } })).toBe('/files/a/b')
    expect(buildUrl('/files/:file{[a-z]+/[0-9]+}', { params: { file: 'a/1' } })).toBe('/files/a/1')
    // a pattern that cannot match "/" at all keeps the encoded value, even when the value does not match the pattern
    expect(buildUrl('/files/:file{[a-z]+}', { params: { file: 'a/b' } })).toBe('/files/a%2Fb')
    // a pattern the engine refuses keeps the encoded value too (Hono would refuse the route at registration)
    expect(buildUrl('/files/:file{a{2,1}}', { params: { file: 'a/b' } })).toBe('/files/a%2Fb')
  })

  it('keeps "/" encoded for a pattern that cannot match it', () => {
    expect(buildUrl('/posts/:id{[0-9]+}', { params: { id: '1/2' } })).toBe('/posts/1%2F2')
    expect(buildUrl('/codes/:code{[a-z]{2,3}}', { params: { code: 'a/b' } })).toBe('/codes/a%2Fb')
  })

  it('refuses an empty segment of a split the pattern accepts, naming the param and the path, never the value', () => {
    const path = '/files/:file{.+/.+}/raw'
    for (const value of ['a//b', 'a b//c', '/a//b']) {
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
      expect((error as Error).message).not.toContain(value)
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

  it('keeps the encoded value when the pattern accepts neither form, so a value that would 404 never throws', () => {
    // :id{[0-9]+} matches neither form: the value is sent encoded and the route 404s, so a server route() over a
    // request-derived value is not a 500
    expect(buildUrl('/posts/:id{[0-9]+}', { params: { id: '1//2' } })).toBe('/posts/1%2F%2F2')
    expect(buildUrl('/posts/:id{[0-9]+}', { params: { id: '1/../2' } })).toBe('/posts/1%2F..%2F2')
    expect(buildUrl('/posts/:id{[0-9]+}', { params: { id: '1/./2' } })).toBe('/posts/1%2F.%2F2')
    // no empty or dot segment: the value keeps the encoded form, which the pattern rejects too
    expect(buildUrl('/posts/:id{[0-9]+}', { params: { id: '1/a' } })).toBe('/posts/1%2Fa')
    // a control character in the same form stays encoded too, never throwing
    expect(buildUrl('/posts/:id{[0-9]+}', { params: { id: '1/\u0000/2' } })).toBe('/posts/1%2F%00%2F2')
    // a leading, trailing or whole "/" leaves an empty segment the pattern cannot match: same outcome
    const path = '/files/:file{.+/.+}/raw'
    expect(buildUrl(path, { params: { file: '/a' } })).toBe('/files/%2Fa/raw')
    expect(buildUrl(path, { params: { file: 'a/' } })).toBe('/files/a%2F/raw')
    expect(buildUrl(path, { params: { file: '/' } })).toBe('/files/%2F/raw')
    // 1 MB neither form accepts: the split is built and tested, its empty segments are never checked, nothing throws
    const unsendable = '1/'.repeat(500_000)
    expect(buildUrl('/posts/:id{[0-9]+}', { params: { id: unsendable } })).toBe(`/posts/${unsendable.replaceAll('/', '%2F')}`)
  })

  it('matches the following static segment as Hono compiles it, so a lookahead pattern can need the split', () => {
    // Hono's trie router compiles a regex param followed by a static segment as "^pattern(?=/raw)": the pattern's own
    // lookahead sees the following segment, so the encoded value matches neither form and the split is the URL it routes
    expect(buildUrl('/files/:file{.+/.+(?=/raw)}/raw', { params: { file: 'a/b' } })).toBe('/files/a/b/raw')
    // the context is every static segment that follows, not only the first
    expect(buildUrl('/files/:file{.+/.+(?=/raw/more)}/raw/more', { params: { file: 'a/b' } })).toBe(
      '/files/a/b/raw/more',
    )
    // a lookahead the following static path cannot satisfy rejects the split too: the encoded value is kept
    expect(buildUrl('/files/:file{.+/.+(?=/raw/x)}/raw', { params: { file: 'a/b' } })).toBe('/files/a%2Fb/raw')
    // a param right after the regex param is no static context (the trie router uses the anchored form there)
    expect(buildUrl('/files/:file{.+/.+(?=/raw)}/:x/raw', { params: { file: 'a/b', x: 1 } })).toBe(
      '/files/a%2Fb/1/raw',
    )
    // a wildcard right after the param is no static context either: buildUrl refuses the "*" segment as usual
    expect(() => buildUrl('/files/:file{.+/.+}/*', { params: { file: 'a/b' } })).toThrow(/has a "\*" segment/)
    // a static segment is literal in the pattern's context, even when it holds a regex metacharacter
    expect(buildUrl('/files/:file{.+/.+}/a|b', { params: { file: 'a/b' } })).toBe('/files/a/b/a|b')
  })

  it('refuses a pattern with "}" before "/", which Hono cuts at that slash and cannot route', () => {
    // Hono reads a pattern up to its first "}" and splits the route on "/", so a quantifier before a slash is cut:
    // `[a-z]{2}/x` becomes `([a-z]{2)/x}`, which matches no path (checked on Hono 4.9.6, both routers)
    for (const path of ['/files/:f{a{2}/*/b}', '/files/:f{[a-z]{2}/x}', '/files/:f{a{2}/.*/b}', '/files/:f{a{2}b/c}']) {
      let error: unknown
      try {
        buildUrl(path as string, { params: { f: 'aa/b' } })
      } catch (thrown) {
        error = thrown
      }
      expect(error).toBeInstanceOf(TypeError)
      expect((error as Error).message).toBe(
        `[@laratype/contract] buildUrl: param "f" for "${path}" has a pattern with "}" before "/", which Hono cannot route`,
      )
    }
    // no "}" before a "/": a quantifier, the static path after the param, or a "/" before the inner "}"
    expect(buildUrl('/files/:f{a{2}}', { params: { f: 'aa' } })).toBe('/files/aa')
    expect(buildUrl('/files/:f{a{2}}/x', { params: { f: 'aa' } })).toBe('/files/aa/x')
    expect(buildUrl('/files/:f{a/b{2}}', { params: { f: 'a/bb' } })).toBe('/files/a/bb')
  })

  it('keeps a "{" inside a character class in the pattern (base behavior)', () => {
    // the base builds this and Hono serves it: the "{" is part of a class, not an unclosed pattern
    expect(buildUrl('/files/:f{[^{]+}', { params: { f: 'abc' } })).toBe('/files/abc')
  })

  it('keeps "%2e%2e" literal: only a segment that is exactly "." or ".." is a dot segment', () => {
    expect(buildUrl('/files/:file{.+/.+}/raw', { params: { file: '%2e%2e/%2e%2E' } })).toBe('/files/%252e%252e/%252e%252E/raw')
  })

  it('refuses an unpaired surrogate through encodeURIComponent, naming the param, never the value', () => {
    for (const path of ['/files/:file{.+/.+}/raw', '/files/:file{.+}']) {
      for (const value of ['\uD800', 'a/\uDC00b']) {
        let error: unknown
        try {
          buildUrl(path, { params: { file: value } })
        } catch (thrown) {
          error = thrown
        }
        expect(error).toBeInstanceOf(TypeError)
        expect((error as Error).message).toBe(
          `[@laratype/contract] buildUrl: param "file" for "${path}" has an unpaired surrogate`,
        )
        expect((error as Error).message).not.toContain('ud800')
        expect((error as Error).message).not.toContain('udc00')
      }
    }
  })

  it('matches the encoded form of a control-character value against the pattern', () => {
    expect(buildUrl('/files/:file{.+}', { params: { file: 'a\u0000b\tc\nd/e' } })).toBe('/files/a%00b%09c%0Ad%2Fe')
  })

  it('matches a 1 MB value against the pattern: encoded whole for ".+", split for ".+/.+"', () => {
    const big = `${'a'.repeat(500_000)}/${'b'.repeat(500_000)}`
    expect(buildUrl('/files/:file{.+}', { params: { file: big } })).toBe(`/files/${'a'.repeat(500_000)}%2F${'b'.repeat(500_000)}`)
    expect(buildUrl('/files/:file{.+/.+}/raw', { params: { file: big } })).toBe(`/files/${big}/raw`)
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
    expect(buildUrl('/files/:file{.*}', { params: { file: 'a/b' } })).toBe('/files/a%2Fb')
    expect(buildUrl('/files/:file{.+/*}', { params: { file: 'a/x' } })).toBe('/files/a%2Fx')
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

  it('needs an object for params and a plain object for query, null and undefined meaning none', () => {
    expect(buildUrl('/health', { params: null as never, query: null as never })).toBe('/health')
    expect(buildUrl('/health', { params: undefined, query: undefined })).toBe('/health')
    for (const value of [42, Number.NaN, 'x', Symbol('x'), true, 1n, () => ({})]) {
      expect(() => buildUrl('/health', { params: value as never })).toThrow(
        new TypeError(`[@laratype/contract] buildUrl: params must be an object, got ${typeof value}`),
      )
      expect(() => buildUrl('/health', { query: value as never })).toThrow(
        new TypeError(`[@laratype/contract] buildUrl: query must be a plain object of keys, got ${typeof value}`),
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
    // a non-finite number is a bug upstream: "/users/NaN" is never the URL a caller meant
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => buildUrl('/users/:user', { params: { user: value } })).toThrow(
        new TypeError(`[@laratype/contract] buildUrl: param "user" for "/users/:user" must be a finite number, got ${value}`),
      )
    }
    expect(buildUrl('/users/:user', { params: { user: 0 } })).toBe('/users/0')
    expect(buildUrl('/users/:user', { params: { user: -1.5 } })).toBe('/users/-1.5')
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
    // a query with a custom prototype is not a plain object: refused rather than reading its prototype
    const inherited = Object.create({ page: 1 }) as { page: number }
    expect(() => buildUrl('/x', { query: inherited })).toThrow(
      new TypeError('[@laratype/contract] buildUrl: query must be a plain object of keys, got an object'),
    )
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
