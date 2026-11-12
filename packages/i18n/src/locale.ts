import { Injectable } from "@laratype/core";

/** Lower-cases a BCP 47 tag for comparison; `_` is normalized to `-`. */
export const normalizeLocale = (locale: string): string => locale.trim().replace(/_/g, "-").toLowerCase();

/** The base language of a tag: `en-US` → `en`. */
export const baseLocale = (locale: string): string => normalizeLocale(locale).split("-")[0]!;

/**
 * Every supported locale for `tag`, in matching order and without duplicates: the exact tag, then its base language
 * (`en-US` → `en`), then the other regions of that language, case-insensitively. Empty when the tag is empty or `*`.
 */
export const matchLocales = (tag: string, available: readonly string[]): string[] => {
  const wanted = normalizeLocale(tag);
  if (wanted.length === 0 || wanted === "*") return [];
  const base = baseLocale(wanted);
  const matches: string[] = [];
  const add = (locale: string | undefined): void => {
    if (locale !== undefined && !matches.includes(locale)) matches.push(locale);
  };
  add(available.find((locale) => normalizeLocale(locale) === wanted));
  add(available.find((locale) => normalizeLocale(locale) === base));
  for (const locale of available) {
    if (baseLocale(locale) === base) add(locale);
  }
  return matches;
};

/**
 * The first supported locale for `tag` (see `matchLocales`), or `undefined` when the tag is empty, `*`, or matches
 * nothing.
 */
export const matchLocale = (tag: string, available: readonly string[]): string | undefined =>
  matchLocales(tag, available)[0];

/**
 * The locale of one request (D6 #112): request-scoped, so `LocaleMiddleware` and the controller read the same value.
 * `Translator` resolves it from the current request scope; outside a request `Translator.setLocale()` sets its default.
 */
@Injectable({ scope: "request" })
export class Locale {
  private value?: string;

  /** The locale this request chose, or `undefined` while the translator default applies. */
  get(): string | undefined {
    return this.value;
  }

  /** Sets the locale the rest of this request reads. */
  set(locale: string): void {
    this.value = locale;
  }
}
