import { Facade } from '@laratype/core'
import { ContextApi } from '@laratype/support'
import type { LangKey, MessageParams, TransArgs } from './types'
import { configuredFallbackLocale, configuredLocale } from './config'
import { lookupMessage, renderMessage } from './catalog'
import type { LangCatalog } from './catalog'
import { Locale } from './Locale'

export interface TranslatorOptions {
  /** Default locale outside a request; `config('i18n.locale')` when omitted. */
  locale?: string
  /** Locale tried after the requested one; `config('i18n.fallback_locale')` when omitted. */
  fallbackLocale?: string
}

/**
 * The translation service behind `trans()`, `__()` and the `Lang` facade (I1 #167). The catalog is loaded once at
 * boot; the locale of a request lives in the request-scoped `Locale` (D6 #112), so a singleton translator is safe.
 */
export class Translator {

  private readonly catalog: LangCatalog
  private locale?: string
  private fallback?: string

  constructor(catalog: LangCatalog = {}, options: TranslatorOptions = {}) {
    this.catalog = catalog
    this.locale = options.locale
    this.fallback = options.fallbackLocale
  }

  /** The translator of the facade application (or a default, empty one outside a booted app). */
  static current(): Translator {
    return Facade.getFacadeApplication().make(Translator)
  }

  /** The request's locale when it chose one, else the translator default from config. */
  getLocale(): string {
    return this.requestLocale()?.get() ?? this.locale ?? configuredLocale()
  }

  /**
   * Sets the locale of the current request (the request-scoped `Locale`), or the translator default outside a request
   * (CLI commands, queued jobs).
   */
  setLocale(locale: string): void {
    const scoped = this.requestLocale()
    if (scoped !== undefined) scoped.set(locale)
    else this.locale = locale
  }

  /** The fallback locale tried after the requested one. */
  getFallbackLocale(): string {
    return this.fallback ?? configuredFallbackLocale()
  }

  /** The locales with a loaded catalog, sorted. */
  locales(): string[] {
    return Object.keys(this.catalog).sort()
  }

  /** Whether `key` has a message in `locale` (its base language included), without falling back to another locale. */
  has(key: string, locale = this.getLocale()): boolean {
    return lookupMessage(this.catalog, key, locale) !== undefined
  }

  /**
   * Translates `key` (`<file>.<dotted key>`): requested locale, its base language, then the fallback locale; returns
   * the key when no locale has it. Placeholders come from `params`, and a plural message selects its form with
   * `Intl.PluralRules` from `params.count`.
   */
  trans<K extends LangKey>(key: K, ...args: TransArgs<K>): string
  trans(key: string, params?: MessageParams, locale?: string): string {
    return this.translate(key, params, locale)
  }

  /** `trans()` without the typed key: for validation messages and other dynamic keys. */
  translate(key: string, params?: MessageParams, locale?: string): string {
    const found = lookupMessage(this.catalog, key, locale ?? this.getLocale(), this.getFallbackLocale())
    if (found === undefined) return key
    return renderMessage(found.message, params, found.locale) ?? key
  }

  /** The request-scoped `Locale`, or `undefined` outside a request. */
  private requestLocale(): Locale | undefined {
    return ContextApi.getContainer()?.make(Locale)
  }

}
