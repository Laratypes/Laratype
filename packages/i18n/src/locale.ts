import { Injectable } from "@laratype/core";

/** Lower-cases a BCP 47 tag for comparison; `_` is normalized to `-`. */
export const normalizeLocale = (locale: string): string => locale.trim().replace(/_/g, "-").toLowerCase();

/** The base language of a tag: `en-US` → `en`. */
export const baseLocale = (locale: string): string => normalizeLocale(locale).split("-")[0]!;

/**
 * A supported locale for `tag`: exact, then its base language (`en-US` → `en`), case-insensitively. `undefined` when
 * the tag is empty or `*`.
 */
export const matchLocale = (tag: string, available: readonly string[]): string | undefined => {
  const wanted = normalizeLocale(tag);
  if (wanted.length === 0 || wanted === "*") return undefined;
  const exact = available.find((locale) => normalizeLocale(locale) === wanted);
  if (exact !== undefined) return exact;
  const base = baseLocale(wanted);
  return (
    available.find((locale) => normalizeLocale(locale) === base) ??
    available.find((locale) => baseLocale(locale) === base)
  );
};

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
