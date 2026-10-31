import { afterEach, describe, expect, it } from "vitest";
import { Facade } from "@laratype/core";
import { Lang, Translator, validationMessage } from "../src";
import type { LangCatalog } from "../src";

const catalog: LangCatalog = {
  en: {
    messages: {},
    validation: {
      required: "The {attribute} field is required (en).",
      min: "The {attribute} field must be at least {min} (en).",
    },
  },
  vi: {
    messages: {},
    validation: {
      required: "Trường {attribute} là bắt buộc.",
    },
  },
};

const useTranslator = (locale: string, fallbackLocale = "en") => {
  Lang.fake(new Translator(catalog, { locale, fallbackLocale }));
};

afterEach(() => {
  Facade.setFacadeApplication(undefined);
});

describe("validationMessage()", () => {
  it("reads the app validation file for the current locale", () => {
    useTranslator("vi");
    expect(validationMessage("required", { attribute: "email" })).toBe("Trường email là bắt buộc.");
  });

  it("falls back to the fallback locale validation file", () => {
    useTranslator("vi");
    expect(validationMessage("min", { attribute: "age", min: 18 })).toBe("The age field must be at least 18 (en).");
  });

  it("uses the built-in English default when the app has no message", () => {
    useTranslator("en");
    expect(validationMessage("email", { attribute: "email" })).toBe("The email field must be a valid email address.");
    expect(validationMessage("confirmed", { attribute: "password" })).toBe(
      "The password field confirmation does not match.",
    );
    expect(validationMessage("nope", { attribute: "x" })).toBe("validation.nope");
  });
});
