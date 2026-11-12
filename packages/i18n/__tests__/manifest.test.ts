import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Container } from "@laratype/core";
import { peekAppManifest, setAppManifest } from "@laratype/support";
import type { AppManifest, ManifestEntry } from "@laratype/support";
import { I18nServiceProvider, Locale, Translator, loadMessages } from "../src";

const entry = (name: string, value: unknown): ManifestEntry => ({
  name,
  path: `lang/${name}.ts`,
  load: async () => ({ default: value }),
});

const manifest = (lang: ManifestEntry[]): AppManifest => ({
  configs: [],
  routes: [],
  commands: [],
  models: [],
  migrations: [],
  seeders: [],
  factories: [],
  modules: [],
  lang,
});

const store = globalThis as { __laratype_manifest?: AppManifest };
let previous: AppManifest | undefined;

beforeEach(() => {
  previous = peekAppManifest();
});

afterEach(() => {
  if (previous) setAppManifest(previous);
  else delete store.__laratype_manifest;
});

describe("loadMessages", () => {
  it("loads lang/<locale>/<file>.ts into a catalog by locale and file", async () => {
    setAppManifest(
      manifest([
        entry("en/messages", { greeting: "Hello {name}" }),
        entry("en/validation", { required: "The {attribute} field is required." }),
        entry("vi/messages", { greeting: "Xin chào {name}" }),
      ]),
    );
    const catalog = await loadMessages();
    expect(Object.keys(catalog).sort()).toEqual(["en", "vi"]);
    expect(catalog.en!.messages).toEqual({ greeting: "Hello {name}" });
    expect(catalog.en!.validation).toEqual({ required: "The {attribute} field is required." });
    expect(catalog.vi!.messages).toEqual({ greeting: "Xin chào {name}" });
  });

  it("reads only own file names and key segments, so a __proto__ file cannot inject one", async () => {
    setAppManifest(
      manifest([
        entry("en/__proto__", { greeting: { text: "from the prototype" } }),
        entry("en/messages", { greeting: "Hello {name}" }),
      ]),
    );
    const catalog = await loadMessages();
    const translator = new Translator(catalog, { locale: "en", fallbackLocale: "en" });

    // The __proto__ file is an own file, not the file dictionary's prototype: its keys are not files of their own.
    expect(translator.has("greeting.text")).toBe(false);
    expect(translator.translate("greeting.text")).toBe("greeting.text");
    // Own properties only: an Object.prototype member never answers a lookup.
    expect(translator.has("messages.constructor")).toBe(false);
    expect(translator.has("messages.toString")).toBe(false);
    expect(translator.has("messages.__proto__")).toBe(false);
    expect(translator.has("messages.greeting")).toBe(true);
  });

  it("rejects an entry that is not in a locale folder, or does not default-export an object", async () => {
    setAppManifest(manifest([entry("messages", { greeting: "Hello" })]));
    await expect(loadMessages()).rejects.toThrow(
      'lang entry "messages" (lang/messages.ts) must be named <locale>/<file>',
    );

    setAppManifest(manifest([entry("en/messages", "Hello")]));
    await expect(loadMessages()).rejects.toThrow("lang/en/messages.ts must default-export an object of messages");
  });

  it("accepts a plural leaf and rejects any other non-string leaf, naming the file and the dotted key", async () => {
    setAppManifest(
      manifest([entry("en/messages", { apples: { one: "{count} apple", other: "{count} apples" } })]),
    );
    const catalog = await loadMessages();
    expect(catalog.en!.messages).toEqual({ apples: { one: "{count} apple", other: "{count} apples" } });

    setAppManifest(manifest([entry("en/messages", { user: { name: 42 } })]));
    await expect(loadMessages()).rejects.toThrow(
      'lang/en/messages.ts: message "messages.user.name" must be a string or a plural object',
    );

    setAppManifest(manifest([entry("en/messages", { apples: { one: "one", other: "other", extra: 1 } })]));
    await expect(loadMessages()).rejects.toThrow('message "messages.apples.extra"');
  });

  it("rejects two locale folders that normalize to the same locale", async () => {
    setAppManifest(
      manifest([
        entry("en-US/messages", { greeting: "Hi" }),
        entry("en_US/messages", { greeting: "Hi" }),
      ]),
    );
    await expect(loadMessages()).rejects.toThrow(
      'lang/en_US/messages.ts: lang folder "en_US" and "en-US" are the same locale ("en-us")',
    );
  });

  it("rejects a file name or a message key containing a dot", async () => {
    setAppManifest(manifest([entry("en/email.subject", { greeting: "Hi" })]));
    await expect(loadMessages()).rejects.toThrow('file name "email.subject" contains "."');

    setAppManifest(manifest([entry("en/messages", { "account.created": "Hi" })]));
    await expect(loadMessages()).rejects.toThrow('message key "messages.account.created" contains "."');
  });
});

describe("I18nServiceProvider", () => {
  it("binds the translator and the request-scoped Locale", async () => {
    setAppManifest(
      manifest([
        entry("en/messages", { greeting: "Hello {name}" }),
        entry("vi/messages", { greeting: "Xin chào {name}" }),
      ]),
    );
    const app = new Container();
    await new I18nServiceProvider(app).register();

    expect(app.has(Locale)).toBe(true);
    const translator = app.make(Translator);
    expect(translator.locales()).toEqual(["en", "vi"]);
    expect(translator.translate("messages.greeting", { name: "Ada" })).toBe("Hello Ada");
    // D6: outside a request scope, the request-scoped Locale cannot be resolved
    expect(() => app.make(Locale)).toThrow("it is request-scoped but no request scope is active");
  });
});
