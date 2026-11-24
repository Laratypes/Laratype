import { describe, expect, it } from 'vitest'
import { isAbsoluteUrl, leavesOrigin } from '@laratype/contract'

/**
 * The one origin rule (C11 #293): whether URL parsing would read a path as another host or another URL. It replaces the
 * contract's `leavesOrigin` (string work) and the client's `keepsOrigin` (`new URL` against two sentinels); every input
 * either of those refused must still be refused.
 */
describe('leavesOrigin', () => {
  it.each([
    ['protocol-relative', '//evil.com'],
    ['three slashes', '///evil.com'],
    ['protocol-relative with a path', '//evil.com/x'],
    ['a sentinel host', '//__laratype_base__/x'],
    ['the other sentinel host', '//__laratype_other__/x'],
    ['an invalid host', '//[bad'],
    ['an empty host', '//'],
    ['a backslash after the slash', '/\\evil.com'],
    ['two backslashes', '\\\\evil.com'],
    ['slashes and backslashes', '/\\/evil.com'],
    ['a backslash and a slash', '\\/evil.com'],
    ['a leading space', ' //evil.com'],
    ['a leading tab', '\t//evil.com'],
    ['a leading C0 control', '\u0001//evil.com'],
    ['leading controls and a space', '\u0000 \t//evil.com'],
    ['http', 'http://evil.com'],
    ['http with one slash', 'http:/evil.com'],
    ['http with no slash', 'http:evil.com'],
    ['a bare scheme', 'http:'],
    ['https with one slash', 'https:/evil.com'],
    ['a mixed-case script scheme', 'JaVaScRiPt:alert(1)'],
    ['a whitespace-prefixed scheme', '\u0001http://evil.com'],
    ['tabs inside the scheme', 'ja\tva\tscript:alert(1)'],
    ['LF inside the scheme', 'java\nscript:alert(1)'],
    ['CR inside the scheme', 'java\rscript:alert(1)'],
    ['a tab inside a scheme', 'h\tttp:/evil.com'],
    ['a host and port', 'localhost:3000/api'],
    ['mailto', 'mailto:x@y'],
    ['data', 'data:text/html,x'],
    ['a one-letter scheme', 'a:b'],
    ['the 1 MB protocol-relative form', `//${'a'.repeat(500_000)}`],
  ])('refuses %s', (_name, path) => {
    expect(leavesOrigin(path)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['a root path', '/'],
    ['a normal path', '/api/users'],
    ['a repeated slash inside', '/a//b'],
    ['a dot segment', '/..//evil.com'],
    ['an encoded slash pair', '/%2F%2Fevil.com'],
    ['an encoded slash pair without a leading slash', '%2F%2Fevil.com'],
    ['an encoded backslash', '/%5Cevil.com'],
    ['an encoded backslash without a leading slash', '%5Cevil.com'],
    ['a lone high surrogate', '\uD800'],
    ['a lone low surrogate after a slash', '/\uDC00'],
    ['a surrogate-prefixed protocol-relative path', '\uDC00//evil.com'],
    ['a DEL-prefixed protocol-relative path', '\u007f//evil.com'],
    ['a NUL inside the path', '/\u0000/evil.com'],
    ['a leading space before a normal path', ' /x'],
    ['a space inside a scheme-like word', 'a b:c'],
    ['a delimited scheme', '1:2'],
    ['a relative path with a colon', './a:b'],
    ['an empty query', '?#'],
    ['a single backslash', '\\evil.com'],
    ['a percent alone', '/%'],
    ['a space in a path', '/a b'],
    ['a space and a protocol-relative suffix', '/a b//evil.com'],
    ['spaces in a scheme-like word', 'h t t p ://x'],
    ['the 1 MB path', `/${'a'.repeat(1_000_000)}`],
  ])('keeps %s', (_name, path) => {
    expect(leavesOrigin(path)).toBe(false)
  })

  it('refuses every input the former URL-based client check refused', () => {
    const bases = ['http://__laratype_base__', 'https://__laratype_other__']
    const urlRefuses = (path: string): boolean => {
      try {
        return !bases.every((base) => new URL(path, base).origin === base)
      } catch {
        return true
      }
    }
    const cases = [
      '//evil.com',
      '//evil.com/x',
      '//__laratype_base__/x',
      '//__laratype_other__/x',
      '//[bad',
      '//',
      '/\\evil.com',
      '\\\\evil.com',
      '/\\/evil.com',
      '\\/evil.com',
      ' //evil.com',
      '\t//evil.com',
      '\u0001//evil.com',
      '\u0000 \t//evil.com',
      'http://evil.com',
      'http:/evil.com',
      'http:evil.com',
      'http:',
      'https:/evil.com',
      'JaVaScRiPt:alert(1)',
      '\u0001http://evil.com',
      'ja\tva\tscript:alert(1)',
      'java\nscript:alert(1)',
      'java\rscript:alert(1)',
      'h\tttp:/evil.com',
      'localhost:3000/api',
      'mailto:x@y',
      'data:text/html,x',
      'a:b',
    ]
    const refused = cases.filter(urlRefuses)
    // the list is not empty: the check above still finds the client's old refusals
    expect(refused.length).toBeGreaterThan(0)
    for (const path of refused) expect(leavesOrigin(path), JSON.stringify(path)).toBe(true)
  })
})

describe('isAbsoluteUrl', () => {
  it('needs a scheme and "//", decided on the raw string', () => {
    for (const value of ['http://x', 'https://example.com:443/a', 'HTTPS://Example.COM/a', 'custom+scheme://x']) {
      expect(isAbsoluteUrl(value), value).toBe(true)
    }
    for (const value of ['', '/api', '//host/api', 'api', 'localhost:3000/api', 'http:/x', 'http:x', 'http:', 'javascript:alert(1)']) {
      expect(isAbsoluteUrl(value), value).toBe(false)
    }
  })
})
