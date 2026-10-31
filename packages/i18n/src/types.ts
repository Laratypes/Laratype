/**
 * The app's translation tree, registered by module augmentation (I1 #167, the K1/Q16 pattern):
 *
 * @example
 * import type messages from '../../lang/en/messages'
 * declare module '@laratype/i18n' {
 *   interface Register { lang: { messages: typeof messages } }
 * }
 */
export interface Register {}

/** The plural categories `Intl.PluralRules` selects. A plural message needs at least `other`. */
export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

/** A plural message: one template per category, `other` required. */
export type PluralForms = { readonly other: string } & Partial<Record<Exclude<PluralCategory, "other">, string>>;

/** A translation file: a string message, a plural message, or a nested group of them. */
export type LangTree = { readonly [key: string]: string | PluralForms | LangTree };

/** The translation trees the app registered, by `lang/<locale>/<file>.ts` file name. */
export type AppLangs = Register extends { lang: infer L } ? L : Record<string, LangTree>;

type PluralCategoryKey = PluralCategory;

/** Whether a node is a plural message rather than a group: every key is a category, and `other` is there. */
type IsPlural<T> = T extends string
  ? false
  : T extends object
    ? [Exclude<keyof T, PluralCategoryKey>] extends [never]
      ? "other" extends keyof T
        ? [T[keyof T]] extends [string]
          ? true
          : false
        : false
      : false
    : false;

/**
 * Every message key: `**<file>.<dotted key>**` (`messages.greeting`, `validation.required`). A plural message is a
 * leaf, so the path stops there.
 */
export type LangPaths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: IsPlural<T[K]> extends true
    ? `${Prefix}${K}`
    : T[K] extends string
      ? `${Prefix}${K}`
      : T[K] extends object
        ? `${Prefix}${K}.${LangPaths<T[K]>}`
        : never;
}[keyof T & string];

/** The registered message keys, or any string before the app registers its lang tree. */
export type LangKey = Register extends { lang: infer L } ? LangPaths<L> : string;

/** Values a placeholder can be replaced with. */
export type MessageParams = Record<string, string | number>;

/** The placeholders of a message: `"Hello {name}"` → `"name"`. */
type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | Placeholders<Rest> : never;

/** Every template of a leaf: a string, or every form of a plural message. */
type Templates<V> = V extends string ? V : V extends object ? Extract<V[keyof V], string> : never;

/** The params a message needs: placeholders as strings, `count` as a number. */
type ParamsOf<V> = V extends PluralForms
  ? { count: number } & { [P in Exclude<Placeholders<Templates<V>>, "count">]: string }
  : { [P in Placeholders<Templates<V>> as P extends "count" ? never : P]: string } & ("count" extends Placeholders<
      Templates<V>
    >
      ? { count: number }
      : {});

/** The params `trans(key, ...)` takes; any record before the app registers its lang tree. */
export type TransParams<K extends string> = string extends LangKey
  ? MessageParams
  : K extends LangKey
    ? ParamsOf<ValueAt<AppLangs, K>>
    : never;

/** The arguments after the key: no params when the message has no placeholders, required ones otherwise. */
export type TransArgs<K extends string> = string extends LangKey
  ? [params?: MessageParams, locale?: string]
  : keyof TransParams<K> extends never
    ? [params?: undefined, locale?: string]
    : [params: TransParams<K>, locale?: string];

type ValueAt<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? ValueAt<T[Head], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;
