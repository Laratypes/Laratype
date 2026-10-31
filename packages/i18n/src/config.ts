import { config } from "@laratype/core";

/**
 * `config()` throws before `ConfigLoadServiceProvider` booted; a package unit test or a CLI helper can run that early.
 * Any other error is a real one and is rethrown.
 */
const readConfig = (path: string): unknown => {
  try {
    return (config as unknown as (key: string) => unknown)(path);
  } catch (error) {
    if (error instanceof Error && error.message.includes("ran before the configs were loaded")) return undefined;
    throw error;
  }
};

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * The app's default locale: `app/config/i18n.ts` (`i18n.locale`), else the 0.5 single config file
 * (`config.locale`), else `en`.
 */
export const configuredLocale = (): string =>
  stringOrUndefined(readConfig("i18n.locale")) ?? stringOrUndefined(readConfig("config.locale")) ?? "en";

/**
 * The fallback locale: `i18n.fallback_locale`, else 0.5 `config.fallback_locale`, else the default locale.
 */
export const configuredFallbackLocale = (): string =>
  stringOrUndefined(readConfig("i18n.fallback_locale")) ??
  stringOrUndefined(readConfig("config.fallback_locale")) ??
  configuredLocale();
