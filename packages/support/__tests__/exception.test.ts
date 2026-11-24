import { afterEach, describe, expect, it, vi } from 'vitest'
import { Console } from '@laratype/console'
import { Exception, InternalException, NotFoundException, ValidationException, isException } from '../src/index'

describe('isException', () => {
  it('is true for an Exception and every subclass', () => {
    expect(isException(new Exception({ message: 'x', reportable: false }))).toBe(true)
    expect(isException(new NotFoundException())).toBe(true)
    expect(isException(new ValidationException({ errors: [] }))).toBe(true)
    expect(isException(new InternalException())).toBe(true)
  })

  it('checks the Symbol.for brand, not instanceof, so an Exception of another package copy counts', () => {
    class Foreign extends Error {
      getErrorCode() { return 'NOT_FOUND' }
      canResponsible() { return true }
      getHttpCode() { return 404 }
      toJson() { return {} }
    }
    Object.defineProperty(Foreign.prototype, Symbol.for('laratype.exception'), { value: true })
    expect(isException(new Foreign())).toBe(true)
  })

  it('is false for any other value', () => {
    expect(isException(new Error('x'))).toBe(false)
    expect(isException({ code: 'NOT_FOUND', canResponsible: () => true })).toBe(false)
    expect(isException(null)).toBe(false)
    // a brand without the public methods of an Exception
    expect(isException(Object.defineProperty(new Error('x'), Symbol.for('laratype.exception'), { value: true }))).toBe(false)
    // or with only some of them
    const partial = Object.assign(new Error('x'), { canResponsible: () => true, getHttpCode: () => 404, toJson: () => ({}) })
    expect(isException(Object.defineProperty(partial, Symbol.for('laratype.exception'), { value: true }))).toBe(false)
    expect(isException('x')).toBe(false)
  })
})

describe('Exception constructor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // #273: reporting belongs to the exception filter, once; building an exception has no side effects
  it('logs nothing, for a reportable exception or a plain one', () => {
    const log = vi.spyOn(Console, 'error').mockImplementation(() => {})

    const reportable = new InternalException('secret detail')
    const plain = new Exception({ message: 'secret detail' })
    // the fields the constructor sets are still there
    expect(reportable.message).toBe('secret detail')
    expect(reportable.getErrorCode()).toBe('INTERNAL_ERROR')
    expect(reportable.getHttpCode()).toBe(500)
    expect(reportable.canResponsible()).toBe(true)
    expect(plain.message).toBe('secret detail')
    expect(plain.getErrorCode()).toBe('')
    expect(plain.canResponsible()).toBe(false)

    expect(log).not.toHaveBeenCalled()
  })
})
