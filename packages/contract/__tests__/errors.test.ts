import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { ContractError, defineError, endpoint, errors } from '@laratype/contract'

describe('defineError', () => {
  it('returns a frozen factory carrying status and code', () => {
    const teapot = defineError(418, 'TEAPOT')

    expect(typeof teapot).toBe('function')
    expect([teapot.status, teapot.code]).toEqual([418, 'TEAPOT'])
    expect(Object.isFrozen(teapot)).toBe(true)
  })

  it('throws a ContractError with { message } as the default body', () => {
    const teapot = defineError(418, 'TEAPOT')
    const e = teapot()

    expect(e).toBeInstanceOf(ContractError)
    expect(e).toBeInstanceOf(Error)
    expect([e.status, e.code, e.body]).toEqual([418, 'TEAPOT', { message: 'TEAPOT' }])
    expect(e.message).toBe('TEAPOT')
    expect(teapot('I am a teapot').body).toEqual({ message: 'I am a teapot' })
    expect(() => {
      throw teapot()
    }).toThrow(ContractError)
  })

  it('builds the body with the body factory', () => {
    const EmailTaken = defineError(409, 'EMAIL_TAKEN', (email: string) => ({ message: 'Taken.', email }))
    const e = EmailTaken('ada@example.com')

    expect(e.body).toEqual({ message: 'Taken.', email: 'ada@example.com' })
    expect(e.message).toBe('Taken.')
    expect(defineError(409, 'X_Y', () => ({ email: 'a' }))().message).toBe('X_Y')
  })

  it('.is() compares the code, not instanceof, so it works across bundles', () => {
    const EmailTaken = defineError(409, 'EMAIL_TAKEN')
    const otherCopy = defineError(409, 'EMAIL_TAKEN')

    expect(EmailTaken.is(otherCopy())).toBe(true)
    expect(EmailTaken.is({ code: 'EMAIL_TAKEN' })).toBe(true)
    expect(EmailTaken.is(defineError(409, 'EMAIL_USED')())).toBe(false)
    expect(EmailTaken.is(new Error('EMAIL_TAKEN'))).toBe(false)
    expect(EmailTaken.is(null)).toBe(false)
    expect(EmailTaken.is('EMAIL_TAKEN')).toBe(false)
  })

  it.each([['email_taken'], ['EmailTaken'], ['EMAIL-TAKEN'], ['_EMAIL'], ['EMAIL_'], ['A__B'], ['']])('rejects the non-UPPER_SNAKE code %j', (code) => {
    expect(() => defineError(409, code)).toThrow(/must be UPPER_SNAKE/)
  })

  it('rejects, when the error is created, a body with its own code (the wire format is { code, ...body })', () => {
    const Bad = defineError(409, 'BAD', (() => ({ code: 'OTHER', message: 'x' })) as never)
    expect(() => Bad()).toThrow(
      new TypeError('[@laratype/contract] BAD: the body must not have its own "code" key (the error is sent as { code, ...body })'),
    )
  })

  it.each([
    ['a string', 'taken', 'string'],
    ['a number', 42, 'number'],
    ['a boolean', true, 'boolean'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['an array', ['a'], 'an array'],
    ['a function', () => 1, 'function'],
  ])('rejects, when the error is created, a body that is %s', (_, value, got) => {
    const Bad = defineError(409, 'BAD', (() => value) as never)
    expect(() => Bad()).toThrow(
      new TypeError(`[@laratype/contract] BAD: the body must be an object, got ${got} (the error is sent as { code, ...body })`),
    )
  })

  it.each([
    ['a Map', () => new Map(), 'Map'],
    ['a Set', () => new Set(), 'Set'],
    ['a Date', () => new Date(0), 'Date'],
    ['a class instance', () => new (class Payload { message = 'x' })(), 'Payload'],
  ])('rejects, when the error is created, a body that is %s: only plain objects', (_, make, got) => {
    const Bad = defineError(409, 'BAD', make as never)
    expect(() => Bad()).toThrow(
      new TypeError(`[@laratype/contract] BAD: the body must be a plain object, got ${got} (the error is sent as { code, ...body })`),
    )
  })

  it('accepts a plain object from another realm (iframe, vm)', () => {
    const foreign = runInNewContext('({ message: "x" })') as { message: string }
    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype)
    expect(defineError(409, 'OK_REALM', () => foreign)().body).toBe(foreign)
    expect(() => defineError(409, 'BAD', (() => runInNewContext('new Map()')) as never)()).toThrow(/must be a plain object, got Map/)
  })

  it('rejects an object whose prototype is a bare null-prototype object (not the Object.prototype of a realm)', () => {
    const body = Object.create(Object.create(null) as object) as Record<string, string>
    body.message = 'x'
    expect(() => defineError(409, 'BAD', () => body)()).toThrow(/must be a plain object, got an object with a custom prototype/)
    // a vm realm's plain object still passes
    expect(defineError(409, 'OK_VM', () => runInNewContext('({ message: "x" })') as { message: string })().body).toEqual({ message: 'x' })
  })

  it('accepts a body with a null prototype', () => {
    const body = Object.assign(Object.create(null) as Record<string, string>, { message: 'x' })
    expect(defineError(409, 'OK_NULL', () => body)().body).toBe(body)
  })

  it('accepts the default { message } body and the catalog bodies', () => {
    expect(defineError(409, 'OK')().body).toEqual({ message: 'OK' })
    expect(errors.validation({ name: ['Required'] }).body).toEqual({ message: 'The given data was invalid.', errors: { name: ['Required'] } })
  })

  it('rejects a non-integer status and a non-function body', () => {
    expect(() => defineError(4.5, 'X')).toThrow(/invalid status/)
    expect(() => defineError('404' as never, 'X')).toThrow(/invalid status/)
    expect(() => defineError(404, 'X', { message: 'x' } as never)).toThrow(/body must be a function/)
  })
})

describe('built-in errors', () => {
  it.each([
    ['unauthorized', 401, 'UNAUTHORIZED'],
    ['forbidden', 403, 'FORBIDDEN'],
    ['notFound', 404, 'NOT_FOUND'],
    ['validation', 422, 'VALIDATION_ERROR'],
    ['tooManyRequests', 429, 'TOO_MANY_REQUESTS'],
  ] as const)('%s -> %i %s', (name, status, code) => {
    expect([errors[name].status, errors[name].code]).toEqual([status, code])
    expect(Object.isFrozen(errors[name])).toBe(true)
  })

  it('has exactly the documented built-ins (no conflict) and is frozen', () => {
    expect(Object.keys(errors).sort()).toEqual(['forbidden', 'notFound', 'tooManyRequests', 'unauthorized', 'validation'])
    expect(Object.isFrozen(errors)).toBe(true)
  })

  it('builds default bodies; validation carries the error bag', () => {
    expect(errors.notFound().body).toEqual({ message: 'Not Found.' })
    expect(errors.forbidden('Nope.').body).toEqual({ message: 'Nope.' })
    expect(errors.validation({ email: ['Required'] }).body).toEqual({ message: 'The given data was invalid.', errors: { email: ['Required'] } })
    expect(errors.notFound.is(errors.notFound())).toBe(true)
    expect(errors.notFound.is(errors.forbidden())).toBe(false)
  })

  it('plugs into .throws() as-is', () => {
    const e = endpoint.get('/search').throws(errors.notFound, errors.forbidden)

    expect(e.def.throws).toEqual([errors.notFound, errors.forbidden])
    expect(e.def.throws[0]).toBe(errors.notFound)
  })
})
