import { loadDefault, appManifest } from "@laratype/support";
import type { AppManifest } from "@laratype/support";
import type { LangTree, MessageParams, PluralCategory } from "./types";
import { baseLocale, normalizeLocale } from "./locale";
import { I18nError } from "./errors";

/** Every loaded translation file, by locale and file name: `catalog.en.messages.greeting`. */
export type LangCatalog = Readonly<Record<string, Readonly<Record<string, LangTree>>>>;

const PLURAL_CATEGORIES: ReadonlySet<string> = new Set<PluralCategory>(["zero", "one", "two", "few", "many", "other"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a node is a plural message: only plural-category keys, `other` present, every template a string. */
export const isPluralForms = (value: unknown): value is Record<string, string> => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.includes("other") &&
    keys.every((key) => PLURAL_CATEGORIES.has(key)) &&
    keys.every((key) => typeof value[key] === "string")
  );
};

/**
 * Reads `appManifest().lang` (`lang/<locale>/<file>.ts`) and loads every file, once, at boot. A key without a locale
 * folder is a manifest error rather than a silent top-level file (I1 #167).
 */
export const loadMessages = async (manifest: AppManifest = appManifest()): Promise<LangCatalog> => {
  const catalog: Record<string, Record<string, LangTree>> = Object.create(null);
  for (const entry of manifest.lang ?? []) {
    const [locale, file, ...rest] = entry.name.split("/");
    if (!locale || !file || rest.length > 0) {
      throw new I18nError(
        `[@laratype/i18n] lang entry "${entry.name}" (${entry.path}) must be named <locale>/<file>: put each file in lang/<locale>/`,
      );
    }
    const tree = await loadDefault<unknown>(entry);
    if (!isRecord(tree)) {
      throw new I18nError(
        `[@laratype/i18n] ${entry.path} must default-export an object of messages (defineLang({...}))`,
      );
    }
    const files = catalog[locale] ?? (catalog[locale] = {});
    files[file] = tree as LangTree;
  }
  return catalog;
};

/** The locale and its base language, without duplicates: `en-US` → `["en-US", "en"]`. */
const localeChain = (locale: string): string[] => {
  const tag = locale.trim().replace(/_/g, "-");
  if (!tag) return [];
  const base = baseLocale(tag);
  return normalizeLocale(tag) === base ? [tag] : [tag, base];
};

/** The catalog's own spelling of a locale (folders are case-sensitive, lookups are not). */
const catalogLocale = (catalog: LangCatalog, locale: string): string | undefined => {
  const wanted = normalizeLocale(locale);
  return Object.keys(catalog).find((key) => normalizeLocale(key) === wanted);
};

/** The message at `file.dotted.key` in one locale, or `undefined` when the path is a group or missing. */
const lookupIn = (catalog: LangCatalog, locale: string, key: string): string | Record<string, string> | undefined => {
  const actual = catalogLocale(catalog, locale);
  if (actual === undefined) return undefined;
  const dot = key.indexOf(".");
  const file = dot === -1 ? key : key.slice(0, dot);
  const path = dot === -1 ? [] : key.slice(dot + 1).split(".");
  let node: unknown = catalog[actual]![file];
  if (node === undefined || path.length === 0) return undefined;
  for (const segment of path) {
    if (!isRecord(node)) return undefined;
    node = node[segment];
    if (node === undefined) return undefined;
  }
  return typeof node === "string" || isPluralForms(node) ? node : undefined;
};

/**
 * The message at `key` for `locale`, trying its base language and then `fallback`. Returns `undefined` when no locale
 * has it, so `trans()` can return the key.
 */
export const lookupMessage = (
  catalog: LangCatalog,
  key: string,
  locale: string,
  fallback?: string,
): { message: string | Record<string, string>; locale: string } | undefined => {
  const candidates = [...localeChain(locale), ...(fallback ? localeChain(fallback) : [])];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeLocale(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const message = lookupIn(catalog, candidate, key);
    if (message !== undefined) return { message, locale: catalogLocale(catalog, candidate) ?? candidate };
  }
  return undefined;
};

/** `{name}` placeholders replaced from `params`; a missing one stays as written. */
export const interpolate = (template: string, params?: MessageParams): string =>
  template.replace(/\{([^{}]+)\}/g, (placeholder, name: string) =>
    params !== undefined && Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );

const pluralRules = new Map<string, Intl.PluralRules>();

/** `Intl.PluralRules` for a locale; an invalid tag falls back to English. */
export const pluralCategory = (locale: string, count: number): PluralCategory => {
  let rules = pluralRules.get(locale);
  if (rules === undefined) {
    try {
      rules = new Intl.PluralRules(locale);
    } catch {
      rules = new Intl.PluralRules("en");
    }
    pluralRules.set(locale, rules);
  }
  return rules.select(count) as PluralCategory;
};

/** Interpolates a string or selects the plural form for `params.count`, then interpolates it. */
export const renderMessage = (
  message: string | Record<string, string>,
  params: MessageParams | undefined,
  locale: string,
): string | undefined => {
  if (typeof message === "string") return interpolate(message, params);
  const count = params?.count;
  const template =
    typeof count === "number" || typeof count === "string"
      ? (message[pluralCategory(locale, Number(count))] ?? message.other)
      : message.other;
  return template === undefined ? undefined : interpolate(template, params);
};
