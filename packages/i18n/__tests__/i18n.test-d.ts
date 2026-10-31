// Type tests for I1 #167: run by `bunx vitest run --project types`.
import { describe, expectTypeOf, it } from 'vitest'
import { __, defineLang, trans } from '@laratype/i18n'
import type { LangKey } from '@laratype/i18n'
import messages from './fixtures/lang/en/messages'

// The app's registration, the K1/Q16 module-augmentation pattern.
declare module '@laratype/i18n' {
  interface Register {
    lang: { messages: typeof messages }
  }
}

/** Type-level checks only: the body is type-checked but never run. */
const typeOnly = (_fn: () => void) => {}

describe('typed translations', () => {
  it('defineLang keeps the message literals', () => {
    const lang = defineLang({ greeting: 'Hello {name}' })
    expectTypeOf(lang.greeting).toEqualTypeOf<'Hello {name}'>()
  })

  it('exposes the registered keys as a union', () => {
    expectTypeOf<LangKey>().toEqualTypeOf<
      'messages.greeting' | 'messages.apples' | 'messages.nested.farewell' | 'messages.plain'
    >()
  })

  it('infers the params from the placeholders', () => {
    expectTypeOf(__('messages.greeting', { name: 'Ada' })).toEqualTypeOf<string>()
    expectTypeOf(trans('messages.nested.farewell', { name: 'Ada' })).toEqualTypeOf<string>()
    expectTypeOf(trans('messages.plain')).toEqualTypeOf<string>()
    expectTypeOf(trans('messages.apples', { count: 2 })).toEqualTypeOf<string>()
  })

  it('rejects unknown keys and missing or extra params', () => {
    typeOnly(() => {
      // @ts-expect-error unknown key
      __('messages.missing')
      // @ts-expect-error greeting has a {name} placeholder
      __('messages.greeting')
      // @ts-expect-error name must be a string
      __('messages.greeting', { name: 1 })
      // @ts-expect-error no extra param
      __('messages.greeting', { name: 'Ada', extra: true })
      // @ts-expect-error count must be a number
      __('messages.apples', { count: '2' })
      // @ts-expect-error a plural message needs count
      __('messages.apples', {})
    })
  })
})
