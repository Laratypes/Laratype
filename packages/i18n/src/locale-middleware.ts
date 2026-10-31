import { Middleware } from "@laratype/http";
import type { Request } from "@laratype/http";
import { ContextApi } from "@laratype/support";
import { setLocale } from "./functions";
import { matchLocale } from "./locale";
import { Translator } from "./translator";

/** The query parameter `LocaleMiddleware` reads, before the user preference and Accept-Language. */
export const LOCALE_QUERY = "locale";

/** `Accept-Language` tags by descending q-value, dropping q=0 and empty entries. `*` is not expanded. */
const parseAcceptLanguage = (header: string): string[] =>
  header
    .split(",")
    .map((part, index) => {
      const [tag, ...parameters] = part.trim().split(";");
      let quality = 1;
      for (const parameter of parameters) {
        const [name, value] = parameter.trim().split("=");
        if (name?.toLowerCase() === "q") {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) quality = parsed;
        }
      }
      return { tag: tag?.trim() ?? "", quality, index };
    })
    .filter(({ tag, quality }) => tag.length > 0 && quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map(({ tag }) => tag);

/**
 * Sets the locale of a request (I1 #167, D6 #112): `?locale=` when it names a catalog locale, else the authenticated
 * user's `locale` (`ContextApi.getUser()`), else the first supported `Accept-Language` tag, else the app default. Only
 * locales with a catalog (plus the default and fallback) are accepted.
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
    const fromHeader = parseAcceptLanguage(request.header("accept-language") ?? "")
      .map((tag) => matchLocale(tag, available))
      .find((locale) => locale !== undefined);

    const locale = fromQuery ?? fromUser ?? fromHeader;
    if (locale !== undefined) setLocale(locale);
    return next(request);
  }
}
