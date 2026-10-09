import { describe, expect, it } from 'vitest'
import { defineError, endpoint, errors } from '@laratype/contract'

describe('defineError', () => {
  it('creates a frozen { status, code } def without a runtime body', () => {
    const teapot = defineError(418, 'TEAPOT')

    expect(teapot).toEqual({ status: 418, code: 'TEAPOT' })
    expect('__body' in teapot).toBe(false)
    expect(Object.isFrozen(teapot)).toBe(true)
  })
})

describe('built-in errors', () => {
  it.each([
    ['unauthorized', 401, 'UNAUTHORIZED'],
    ['forbidden', 403, 'FORBIDDEN'],
    ['notFound', 404, 'NOT_FOUND'],
    ['conflict', 409, 'CONFLICT'],
    ['validation', 422, 'VALIDATION_ERROR'],
    ['tooManyRequests', 429, 'TOO_MANY_REQUESTS'],
  ] as const)('%s -> %i %s', (name, status, code) => {
    expect(errors[name]).toEqual({ status, code })
    expect(Object.isFrozen(errors[name])).toBe(true)
  })

  it('has exactly the documented built-ins and is frozen', () => {
    expect(Object.keys(errors).sort()).toEqual(
      ['conflict', 'forbidden', 'notFound', 'tooManyRequests', 'unauthorized', 'validation'],
    )
    expect(Object.isFrozen(errors)).toBe(true)
  })

  it('plugs into the endpoint builder as-is', () => {
    const e = endpoint.get('/users/:user').errors(errors.notFound, errors.forbidden)

    expect(e.def.errors).toEqual([errors.notFound, errors.forbidden])
    expect(e.def.errors[0]).toBe(errors.notFound)
  })
})
