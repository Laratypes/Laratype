import { Translator } from "./translator";
import type { LangKey, MessageParams, TransArgs } from "./types";

/**
 * Translates a registered key (I1 #167): `<file>.<dotted key>` in the current request locale, then its base language,
 * then `config('i18n.fallback_locale')`; returns the key when no locale has it.
 */
export function trans<K extends LangKey>(key: K, ...args: TransArgs<K>): string;
export function trans(key: string, params?: MessageParams, locale?: string): string {
  return Translator.current().translate(key, params, locale);
}

/** Alias of `trans()`, as in Laravel. */
export const __: typeof trans = trans;

/** The locale of the current request, or the app default outside one. */
export const getLocale = (): string => Translator.current().getLocale();

/** Switches the locale of the current request (or the app default outside one). */
export const setLocale = (locale: string): void => {
  Translator.current().setLocale(locale);
};

/** The locales with a loaded catalog, sorted. */
export const locales = (): string[] => Translator.current().locales();
