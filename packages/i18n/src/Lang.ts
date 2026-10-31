import { Facade } from '@laratype/core'
import type { LangKey, TransArgs } from './types'
import { Translator } from './Translator'

/** D8 facade over `Translator`: `Lang.trans(...)`, `Lang.getLocale()`, `Lang.setLocale(...)` and `Lang.fake(...)`. */
export class Lang extends Facade {

  static override readonly accessor = Translator

  static trans<K extends LangKey>(key: K, ...args: TransArgs<K>): string {
    return Lang.root().trans(key, ...args)
  }

  static getLocale(): string {
    return Lang.root().getLocale()
  }

  static setLocale(locale: string): void {
    Lang.root().setLocale(locale)
  }

  static getFallbackLocale(): string {
    return Lang.root().getFallbackLocale()
  }

  static locales(): string[] {
    return Lang.root().locales()
  }

  static has(key: string, locale?: string): boolean {
    return Lang.root().has(key, locale)
  }

}
