import { interpolate } from "./catalog";
import { Translator } from "./translator";
import type { MessageParams } from "./types";

/**
 * English defaults for the rule names H10 (#137) can pass to `validationMessage()`. An app overrides any of them in
 * `lang/<locale>/validation.ts` under the same rule name; other locales fall back to these.
 */
const DEFAULT_VALIDATION_MESSAGES: Readonly<Record<string, string>> = {
  required: "The {attribute} field is required.",
  string: "The {attribute} field must be a string.",
  number: "The {attribute} field must be a number.",
  integer: "The {attribute} field must be an integer.",
  boolean: "The {attribute} field must be true or false.",
  array: "The {attribute} field must be an array.",
  object: "The {attribute} field must be an object.",
  email: "The {attribute} field must be a valid email address.",
  url: "The {attribute} field must be a valid URL.",
  uuid: "The {attribute} field must be a valid UUID.",
  date: "The {attribute} field must be a valid date.",
  min: "The {attribute} field must be at least {min}.",
  max: "The {attribute} field must not be greater than {max}.",
  length: "The {attribute} field must be {length} characters.",
  regex: "The {attribute} field format is invalid.",
  enum: "The selected {attribute} is invalid.",
  in: "The selected {attribute} is invalid.",
  confirmed: "The {attribute} field confirmation does not match.",
};

/**
 * The localized message of a validation rule, read from `validation.<rule>` (`lang/<locale>/validation.ts`) and
 * interpolated; the built-in English message when the app has none, and `validation.<rule>` when neither exists. H10
 * wires this into FormRequest v2's `messages()`; this package only provides the lookup (I1 #167).
 */
export const validationMessage = (rule: string, params?: MessageParams, locale?: string): string => {
  const key = `validation.${rule}`;
  const translated = Translator.current().translate(key, params, locale);
  if (translated !== key) return translated;
  const template = DEFAULT_VALIDATION_MESSAGES[rule];
  return template === undefined ? key : interpolate(template, params);
};
