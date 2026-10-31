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

  it("rejects an entry that is not in a locale folder, or does not default-export an object", async () => {
    setAppManifest(manifest([entry("messages", { greeting: "Hello" })]));
    await expect(loadMessages()).rejects.toThrow(
      'lang entry "messages" (lang/messages.ts) must be named <locale>/<file>',
    );

    setAppManifest(manifest([entry("en/messages", "Hello")]));
    await expect(loadMessages()).rejects.toThrow("lang/en/messages.ts must default-export an object of messages");
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
