import { afterEach, describe, expect, it } from "vitest";
import { Facade, setConfigs } from "@laratype/core";
import { Lang, Translator, __, getLocale, locales, setLocale, trans } from "../src";
import type { LangCatalog } from "../src";

const catalog: LangCatalog = {
  en: {
    messages: {
      greeting: "Hello {name}",
      apples: { one: "{count} apple", other: "{count} apples" },
      nested: { farewell: "Bye {name}" },
      plain: "No params",
    },
  },
  vi: {
    messages: {
      greeting: "Xin chào {name}",
      apples: { other: "{count} quả táo" },
    },
  },
  ru: {
    messages: {
      apples: { one: "{count} яблоко", few: "{count} яблока", many: "{count} яблок", other: "{count} яблока" },
    },
  },
};

const useTranslator = (locale = "en", fallbackLocale = "en") => {
  const translator = new Translator(catalog, { locale, fallbackLocale });
  Lang.fake(translator);
  return translator;
};

afterEach(() => {
  setConfigs({});
  Facade.setFacadeApplication(undefined);
});

describe("trans() / __()", () => {
  it("interpolates placeholders in the current locale", () => {
    useTranslator("en");
    expect(__("messages.greeting", { name: "Ada" })).toBe("Hello Ada");
    expect(trans("messages.nested.farewell", { name: "Ada" })).toBe("Bye Ada");
    expect(trans("messages.plain")).toBe("No params");
  });

  it("switches the locale with setLocale() and takes an explicit locale argument", () => {
    useTranslator("en");
    setLocale("vi");
    expect(getLocale()).toBe("vi");
    expect(__("messages.greeting", { name: "Ada" })).toBe("Xin chào Ada");
    expect(trans("messages.greeting", { name: "Ada" }, "en")).toBe("Hello Ada");
    expect(trans("messages.greeting", { name: "Ada" }, "vi")).toBe("Xin chào Ada");
    expect(trans("messages.greeting", { name: "Ada" }, "en-US")).toBe("Hello Ada");
  });

  it("falls back from a missing locale and a missing key to the fallback locale, then returns the key", () => {
    useTranslator("fr", "en");
    expect(__("messages.greeting", { name: "Ada" })).toBe("Hello Ada");
    const looseTrans = __ as unknown as (key: string) => string;
    expect(looseTrans("messages.missing")).toBe("messages.missing");
  });

  it("selects plural forms with Intl.PluralRules", () => {
    useTranslator("en");
    expect(trans("messages.apples", { count: 1 })).toBe("1 apple");
    expect(trans("messages.apples", { count: 3 })).toBe("3 apples");
    expect(trans("messages.apples", { count: 3 }, "ru")).toBe("3 яблока");
    expect(trans("messages.apples", { count: 5 }, "ru")).toBe("5 яблок");
    expect(trans("messages.apples", { count: 3 }, "vi")).toBe("3 quả táo");
  });

  it("matches a base language to a catalog's sibling region, as LocaleMiddleware does", () => {
    Lang.fake(
      new Translator(
        { "en-US": { messages: { greeting: "Hello {name}" } } },
        { locale: "en", fallbackLocale: "en" },
      ),
    );
    expect(trans("messages.greeting", { name: "Ada" })).toBe("Hello Ada");
    expect(__("messages.greeting", { name: "Ada" })).toBe("Hello Ada");
  });

  it("normalizes the locale before Intl.PluralRules: fr_FR count 0 uses the French one", () => {
    Lang.fake(
      new Translator(
        { fr_FR: { messages: { apples: { one: "{count} pomme", other: "{count} pommes" } } } },
        { locale: "fr_FR", fallbackLocale: "en" },
      ),
    );
    expect(trans("messages.apples", { count: 0 })).toBe("0 pomme");
    expect(trans("messages.apples", { count: 2 })).toBe("2 pommes");
  });

  it("reuses one fallback translator without a provider, so setLocale persists, and a later fake wins", () => {
    expect(getLocale()).toBe("en");
    setLocale("vi");
    expect(getLocale()).toBe("vi");
    Lang.fake(new Translator(catalog, { locale: "en" }));
    expect(getLocale()).toBe("en");
  });

  it("the Lang facade shares the fallback translator with the helpers", () => {
    expect(Lang.getLocale()).toBe("en");
    Lang.setLocale("vi");
    expect(Lang.getLocale()).toBe("vi");
    expect(getLocale()).toBe("vi");
    Lang.fake(new Translator(catalog, { locale: "ru" }));
    expect(Lang.getLocale()).toBe("ru");
    expect(getLocale()).toBe("ru");
  });

  it("has() and locales() read the loaded catalog", () => {
    useTranslator("en");
    expect(Lang.has("messages.greeting")).toBe(true);
    expect(Lang.has("messages.missing")).toBe(false);
    expect(Lang.has("messages.greeting", "vi")).toBe(true);
    expect(Lang.has("messages.greeting", "ru")).toBe(false);
    expect(locales()).toEqual(["en", "ru", "vi"]);
  });

  it("reads locale and fallback_locale from the v1 i18n config and the 0.5 config file", () => {
    setConfigs({ i18n: { locale: "vi", fallback_locale: "en" } });
    const fromI18n = new Translator(catalog);
    Lang.fake(fromI18n);
    expect(getLocale()).toBe("vi");
    expect(fromI18n.getFallbackLocale()).toBe("en");
    expect(__("messages.greeting", { name: "Ada" })).toBe("Xin chào Ada");

    setConfigs({ config: { locale: "fr", fallback_locale: "en" } });
    const fromLegacy = new Translator(catalog);
    Lang.fake(fromLegacy);
    expect(getLocale()).toBe("fr");
    expect(__("messages.greeting", { name: "Ada" })).toBe("Hello Ada");
  });
});
