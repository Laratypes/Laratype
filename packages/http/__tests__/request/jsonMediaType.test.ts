// H31 #308: JSON is the leading media type, its parameters ignored, so a header Hono's `validator('json')` rejects is
// still JSON for the pipeline (docs/v1/validation.md › Pipeline validation and 422 › Invariants)
import { describe, expect, it } from 'vitest'
import { isJsonMediaType } from '../../src/request/bodyLimit'

describe('isJsonMediaType', () => {
  it.each([
    'application/json',
    'Application/JSON',                                 // media types are case-insensitive (RFC 9110 §8.3.1)
    'application/json;',                                // an empty parameter list (H31 #308)
    'application/json ; charset=utf-8',                 // OWS before the `;`
    'application/json;charset=utf-8',
    'application/json; a_b=c',                          // `_` in a parameter name (an RFC 9110 token)
    'application/json; a="x;y"',                        // a quoted `;` in a value
    'application/vnd.api+json',
    'application/vnd.a+b+json',                         // `+` inside the vendor subtype
    'application/vnd.github.v3+json',
    'application/vnd.my_app+json',
    ' application/json ',                               // OWS around the value (`Headers` strips it, a direct call may not)
    'application/json; ; ;',
  ])('%s is JSON', (contentType) => {
    expect(isJsonMediaType(contentType)).toBe(true)
  })

  it.each([
    undefined,
    '',
    'text/json',
    'json',
    'application/json-patch',
    'application/+json',                                // a structured suffix needs a name before it (RFC 6838)
    'application/json, text/plain',                     // a multi-valued Content-Type is the 400 before this
    'application/jsonx',
    'application/ld+jsonx',
    '\u0000application/json',
  ])('%o is not JSON', (contentType) => {
    expect(isJsonMediaType(contentType)).toBe(false)
  })

  it('never reads the parameters, however long or malformed', () => {
    expect(isJsonMediaType(`application/json; a=${'x'.repeat(100_000)}`)).toBe(true)
    expect(isJsonMediaType('application/json; a="\uD800"')).toBe(true)
    // a lone surrogate in the subtype is not a JSON subtype, and never throws
    expect(isJsonMediaType('application/\uD800+json')).toBe(false)
  })
})
