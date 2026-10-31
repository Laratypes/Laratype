import { Facade } from "@laratype/core";
import type { LangKey, TransArgs } from "./types";
import { Translator } from "./translator";

/** D8 facade over `Translator`: `Lang.trans(...)`, `Lang.getLocale()`, `Lang.setLocale(...)` and `Lang.fake(...)`. */
export class Lang extends Facade {
  static override readonly accessor = Translator;

  /** Translates a registered key in the current request locale. */
  static trans<K extends LangKey>(key: K, ...args: TransArgs<K>): string {
    return Lang.root().trans(key, ...args);
  }

  /** The locale of the current request, or the app default outside one. */
  static getLocale(): string {
    return Lang.root().getLocale();
  }

  /** Switches the locale of the current request (or the app default outside one). */
  static setLocale(locale: string): void {
    Lang.root().setLocale(locale);
  }

  /** The locale tried after the requested one. */
  static getFallbackLocale(): string {
    return Lang.root().getFallbackLocale();
  }

  /** The locales with a loaded catalog, sorted. */
  static locales(): string[] {
    return Lang.root().locales();
  }

  /** Whether a key has a message in `locale` (its base language included), without another locale's fallback. */
  static has(key: string, locale?: string): boolean {
    return Lang.root().has(key, locale);
  }
}
