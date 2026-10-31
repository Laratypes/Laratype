import { Injectable } from '@laratype/core'

/**
 * The locale of one request (D6 #112): request-scoped, so `LocaleMiddleware` and the controller read the same value.
 * `Translator` resolves it from the current request scope; outside a request `Translator.setLocale()` sets its default.
 */
@Injectable({ scope: 'request' })
export class Locale {

  private value?: string

  /** The locale this request chose, or `undefined` while the translator default applies. */
  get(): string | undefined {
    return this.value
  }

  set(locale: string): void {
    this.value = locale
  }

}
