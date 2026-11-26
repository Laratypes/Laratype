/**
 * A name on one line: control and format characters, line separators and backslashes are escaped (D10's helper,
 * shared by the container's messages and the facade's warnings).
 */
export const escapeName = (name: string): string =>
  name.replace(/[\p{Cc}\p{Cf}\u2028\u2029\\]/gu, (char) => {
    if (char === '\\') return '\\\\'
    const code = char.codePointAt(0)!
    // A supplementary format character escapes as its UTF-16 surrogate pair, so the second unit is not dropped.
    if (code > 0xffff) {
      const offset = code - 0x10000
      return `\\u${(0xd800 + (offset >> 10)).toString(16)}\\u${(0xdc00 + (offset & 0x3ff)).toString(16)}`
    }
    return `\\u${code.toString(16).padStart(4, '0')}`
  })
