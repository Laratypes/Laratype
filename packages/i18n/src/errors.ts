/**
 * An error thrown by `@laratype/i18n`: a malformed `lang` manifest entry, or a translation file that does not
 * default-export an object (I1 #167).
 */
export class I18nError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "I18nError";
  }
}
