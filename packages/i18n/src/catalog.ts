import { loadDefault, appManifest } from "@laratype/support";
import type { AppManifest } from "@laratype/support";
import type { LangTree, MessageParams, PluralCategory } from "./types";
import { matchLocales, normalizeLocale } from "./locale";
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
 * Checks a file's messages at load: a key segment cannot contain `.`, because lookup splits `<file>.<dotted key>` on
 * dots, and every leaf must be a string or a plural form (`other` plus only plural categories, all strings).
 */
const validateTree = (
  tree: Record<string, unknown>,
  file: string,
  sourcePath: string,
  path: readonly string[] = [],
): void => {
  for (const [key, value] of Object.entries(tree)) {
    const dotted = [file, ...path, key].join(".");
    if (key.includes(".")) {
      throw new I18nError(
        `[@laratype/i18n] ${sourcePath}: message key "${dotted}" contains ".": keys are <file>.<dotted key>, so a dot cannot be part of a file name or key`,
      );
    }
    if (typeof value === "string" || isPluralForms(value)) continue;
    if (isRecord(value)) {
      validateTree(value, file, sourcePath, [...path, key]);
      continue;
    }
    throw new I18nError(
      `[@laratype/i18n] ${sourcePath}: message "${dotted}" must be a string or a plural object ({ other, one, two, few, many, zero } with string templates)`,
    );
  }
};

/**
 * Reads `appManifest().lang` (`lang/<locale>/<file>.ts`) and loads every file, once, at boot. A key without a locale
 * folder is a manifest error rather than a silent top-level file; so are two folders that normalize to one locale
 * (`en-US`, `en_US`), a file name or key with a dot, and a leaf that is neither a string nor a plural form (I1 #167).
 */
export const loadMessages = async (manifest: AppManifest = appManifest()): Promise<LangCatalog> => {
  const catalog: Record<string, Record<string, LangTree>> = Object.create(null);
  const locales = new Map<string, string>();
  for (const entry of manifest.lang ?? []) {
    const [locale, file, ...rest] = entry.name.split("/");
    if (!locale || !file || rest.length > 0) {
      throw new I18nError(
        `[@laratype/i18n] lang entry "${entry.name}" (${entry.path}) must be named <locale>/<file>: put each file in lang/<locale>/`,
      );
    }
    const normalized = normalizeLocale(locale);
    const known = locales.get(normalized);
    if (known !== undefined && known !== locale) {
      throw new I18nError(
        `[@laratype/i18n] ${entry.path}: lang folder "${locale}" and "${known}" are the same locale ("${normalized}"): spell a locale one way`,
      );
    }
    locales.set(normalized, locale);
    if (file.includes(".")) {
      throw new I18nError(
        `[@laratype/i18n] ${entry.path}: file name "${file}" contains ".": keys are <file>.<dotted key>, so a dot cannot be part of a file name or key`,
      );
    }
    const tree = await loadDefault<unknown>(entry);
    if (!isRecord(tree)) {
      throw new I18nError(
        `[@laratype/i18n] ${entry.path} must default-export an object of messages (defineLang({...}))`,
      );
    }
    validateTree(tree, file, entry.path);
    // A null prototype keeps a file named "__proto__" an ordinary own key instead of the dictionary's prototype.
    const files = catalog[locale] ?? (catalog[locale] = Object.create(null) as Record<string, LangTree>);
    files[file] = tree as LangTree;
  }
  return catalog;
};

/**
 * The message at `file.dotted.key` in the catalog locale `actual`, or `undefined` when the path is a group or missing.
 */
const lookupIn = (catalog: LangCatalog, actual: string, key: string): string | Record<string, string> | undefined => {
  if (!Object.hasOwn(catalog, actual)) return undefined;
  const dot = key.indexOf(".");
  const file = dot === -1 ? key : key.slice(0, dot);
  const path = dot === -1 ? [] : key.slice(dot + 1).split(".");
  const files = catalog[actual]!;
  if (path.length === 0 || !Object.hasOwn(files, file)) return undefined;
  let node: unknown = files[file];
  for (const segment of path) {
    // Own properties only: a "__proto__" or "constructor" segment must not read the file's prototype chain.
    if (!isRecord(node) || !Object.hasOwn(node, segment)) return undefined;
    node = node[segment];
  }
  return typeof node === "string" || isPluralForms(node) ? node : undefined;
};

/**
 * The message at `key` for `locale`, trying every catalog match of the tag (exact, base language, then sibling regions)
 * and then the same matches for `fallback`. Returns `undefined` when no locale has it, so `trans()` can return the key.
 */
export const lookupMessage = (
  catalog: LangCatalog,
  key: string,
  locale: string,
  fallback?: string,
): { message: string | Record<string, string>; locale: string } | undefined => {
  const candidates = [
    ...matchLocales(locale, Object.keys(catalog)),
    ...(fallback ? matchLocales(fallback, Object.keys(catalog)) : []),
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeLocale(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const message = lookupIn(catalog, candidate, key);
    if (message !== undefined) return { message, locale: candidate };
  }
  return undefined;
};

/** `{name}` placeholders replaced from `params`; a missing one stays as written. */
export const interpolate = (template: string, params?: MessageParams): string =>
  template.replace(/\{([^{}]+)\}/g, (placeholder, name: string) =>
    params !== undefined && Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );

const pluralRules = new Map<string, Intl.PluralRules>();

/** `Intl.PluralRules` for a locale; an invalid tag falls back to English, and `fr_FR` uses the French rules. */
export const pluralCategory = (locale: string, count: number): PluralCategory => {
  const tag = normalizeLocale(locale);
  let rules = pluralRules.get(tag);
  if (rules === undefined) {
    try {
      rules = new Intl.PluralRules(tag);
    } catch {
      rules = new Intl.PluralRules("en");
    }
    pluralRules.set(tag, rules);
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
