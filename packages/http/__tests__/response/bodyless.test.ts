// X3 #157: the exception filter and the undeclared-error check read one bodyless-status rule, so both agree on whether a
// code reaches the client
import { describe, expect, it } from 'vitest'
import { isBodylessResponse } from '../../src/response/bodyless'

describe('isBodylessResponse', () => {
  it.each([
    [204, true],
    [205, true],
    [304, true],
    [101, false],
    [200, false],
    [201, false],
    [203, false],
    [206, false],
    [301, false],
    [305, false],
    [400, false],
    [500, false],
    [-1, false],
    [204.5, false],
    [1e9, false],
    [NaN, false],
    [Infinity, false],
    [-Infinity, false],
  ] as const)('%s → %s', (status, bodyless) => {
    expect(isBodylessResponse(status)).toBe(bodyless)
  })

  it.each([
    ['an object', { length: 1e9 }],
    ['a numeric string', '304'],
    ['null', null],
    ['undefined', undefined],
  ])('%s status is not bodyless', (_, status) => {
    expect(isBodylessResponse(status as number)).toBe(false)
  })
})
