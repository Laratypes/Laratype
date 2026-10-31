import { config } from '@laratype/core'

/** `config()` reads the registered configs; internal lookups run before they load in tests, so a throw means unset. */
const read = (path: string): unknown => {
  try {
    return (config as unknown as (key: string) => unknown)(path)
  } catch {
    return undefined
  }
}

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

/**
 * The app's default locale: `app/config/i18n.ts` (`i18n.locale`), else the 0.5 single config file
 * (`config.locale`), else `en`.
 */
export const configuredLocale = (): string =>
  stringOrUndefined(read('i18n.locale')) ?? stringOrUndefined(read('config.locale')) ?? 'en'

/**
 * The fallback locale: `i18n.fallback_locale`, else 0.5 `config.fallback_locale`, else the default locale.
 */
export const configuredFallbackLocale = (): string =>
  stringOrUndefined(read('i18n.fallback_locale')) ?? stringOrUndefined(read('config.fallback_locale')) ?? configuredLocale()
