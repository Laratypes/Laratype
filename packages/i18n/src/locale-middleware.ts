import { Middleware } from "@laratype/http";
import type { Request } from "@laratype/http";
import { ContextApi } from "@laratype/support";
import { setLocale } from "./functions";
import { matchLocale, normalizeLocale } from "./locale";
import { Translator } from "./translator";
import { warnNoRequestContainer } from "./warnings";

/** The query parameter `LocaleMiddleware` reads, before the user preference and Accept-Language. */
export const LOCALE_QUERY = "locale";

/** An `Accept-Language` range with its quality and position: a q=0 range excludes its tag from selection. */
interface LanguageRange {
  readonly tag: string;
  readonly quality: number;
  readonly index: number;
}

/**
 * RFC 9110 §12.4.2 qvalue: `0`–`1` with at most three decimals; `undefined` for anything else (empty, non-numeric,
 * out of range).
 */
const parseQuality = (value: string): number | undefined => {
  const trimmed = value.trim();
  return /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(trimmed) ? Number(trimmed) : undefined;
};

/**
 * `Accept-Language` ranges by descending q-value, keeping q=0 ranges so they can exclude a tag. `*` is not expanded.
 * A range with a malformed q (empty, non-numeric, outside 0..1, more than three decimals) is skipped: it is neither
 * q=0 (an exclusion) nor q=1.
 */
const parseAcceptLanguage = (header: string): LanguageRange[] =>
  header
    .split(",")
    .flatMap((part, index) => {
      const [tag, ...parameters] = part.trim().split(";");
      const trimmed = tag?.trim() ?? "";
      if (trimmed.length === 0) return [];
      let quality = 1;
      for (const parameter of parameters) {
        const [name, ...values] = parameter.trim().split("=");
        if (name?.toLowerCase() !== "q") continue;
        const parsed = parseQuality(values.join("="));
        if (parsed === undefined) return [];
        quality = parsed;
      }
      return [{ tag: trimmed, quality, index }];
    })
    .sort((a, b) => b.quality - a.quality || a.index - b.index);

/**
 * Sets the locale of a request (I1 #167, D6 #112): `?locale=` when it names a catalog locale, else the authenticated
 * user's `locale` (`ContextApi.getUser()`), else the first supported, non-excluded `Accept-Language` tag, else the app
 * default. Only locales with a catalog (plus the default and fallback) are accepted; an exact tag with `q=0` is never
 * chosen from the header. A route without a request container (no `RequestKernel`) is left on the app default, with a
 * one-time dev warning: setting the shared default there would leak into later requests.
 *
 * Registered as a 0.5 middleware (`Route.middleware(LocaleMiddleware)`); the pipeline creates it with no arguments.
 */
export class LocaleMiddleware extends Middleware {
  /** Resolves the request locale and stores it in the request-scoped `Locale`, then continues the pipeline. */
  async handle(
    request: Request,
    _res: Response,
    next: (request: Request) => Promise<unknown> | unknown,
  ): Promise<unknown> {
    const translator = Translator.current();
    const available = [...new Set([...translator.locales(), translator.getLocale(), translator.getFallbackLocale()])];

    const query = request.query(LOCALE_QUERY);
    const fromQuery = typeof query === "string" ? matchLocale(query, available) : undefined;
    const preference = ContextApi.getUser<{ locale?: unknown }>()?.locale;
    const fromUser = typeof preference === "string" ? matchLocale(preference, available) : undefined;
    const ranges = parseAcceptLanguage(request.header("accept-language") ?? "");
    const excluded = new Set(
      ranges.filter(({ quality }) => quality === 0).map(({ tag }) => normalizeLocale(tag)),
    );
    const fromHeader = ranges
      .filter(({ quality }) => quality > 0)
      .map(({ tag }) => matchLocale(tag, available))
      .find((locale) => locale !== undefined && !excluded.has(normalizeLocale(locale)));

    const locale = fromQuery ?? fromUser ?? fromHeader;
    if (locale === undefined) return next(request);
    if (ContextApi.getContainer() === undefined) {
      warnNoRequestContainer("LocaleMiddleware");
      return next(request);
    }
    setLocale(locale);
    return next(request);
  }
}
