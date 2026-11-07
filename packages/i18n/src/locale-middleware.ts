import { Middleware } from "@laratype/http";
import type { Request } from "@laratype/http";
import { ContextApi } from "@laratype/support";
import { setLocale } from "./functions";
import { matchLocale, normalizeLocale } from "./locale";
import { Translator } from "./translator";

/** The query parameter `LocaleMiddleware` reads, before the user preference and Accept-Language. */
export const LOCALE_QUERY = "locale";

/** Set once the no-request-container warning printed: per process, so a dev restart does not print it again. */
const NO_CONTAINER_WARNED = Symbol.for("laratype.i18n.localeMiddlewareNoContainer");

/**
 * One-time dev warning for a route served without `RequestKernel`: there is no request scope to hold the locale, so
 * the middleware skips instead of changing the shared default. Silent in production.
 */
const warnNoContainer = (): void => {
  const store = globalThis as {
    __PROD__?: boolean;
    process?: { env?: Record<string, string | undefined> };
    [NO_CONTAINER_WARNED]?: true;
  };
  const production = store.__PROD__ ?? store.process?.env?.NODE_ENV === "production";
  if (production || store[NO_CONTAINER_WARNED]) return;
  store[NO_CONTAINER_WARNED] = true;
  console.warn(
    "[@laratype/i18n] LocaleMiddleware has no request container (the route is not served through RequestKernel), so it left the app default locale unchanged: serve the route through RequestKernel to choose a locale per request.",
  );
};

/** An `Accept-Language` range with its quality and position: a q=0 range excludes its tag from selection. */
interface LanguageRange {
  readonly tag: string;
  readonly quality: number;
  readonly index: number;
}

/** `Accept-Language` ranges by descending q-value, keeping q=0 ranges so they can exclude a tag. `*` is not expanded. */
const parseAcceptLanguage = (header: string): LanguageRange[] =>
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
    .filter(({ tag, quality }) => tag.length > 0 && quality >= 0)
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
      warnNoContainer();
      return next(request);
    }
    setLocale(locale);
    return next(request);
  }
}
