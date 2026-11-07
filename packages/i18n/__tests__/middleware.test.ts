import { afterEach, describe, expect, it, vi } from "vitest";
import { Container, Facade } from "@laratype/core";
import { ContextApi } from "@laratype/support";
import type { Request } from "@laratype/http";
import { Locale, LocaleMiddleware, Translator, getLocale, setLocale } from "../src";
import type { LangCatalog } from "../src";

const catalog: LangCatalog = {
  en: { messages: { greeting: "Hello {name}" } },
  vi: { messages: { greeting: "Xin chào {name}" } },
  ru: { messages: { greeting: "Привет {name}" } },
};

const request = (query: Record<string, string> = {}, headers: Record<string, string> = {}): Request =>
  ({
    query: (key?: string) => (key === undefined ? query : query[key]),
    header: (key: string) => headers[key.toLowerCase()],
  }) as unknown as Request;

const next = (value: unknown) => value;

const setup = (
  langs: LangCatalog = catalog,
  options: { locale?: string; fallbackLocale?: string } = {},
) => {
  const app = new Container();
  app.scoped(Locale);
  app.instance(
    Translator,
    new Translator(langs, { locale: options.locale ?? "en", fallbackLocale: options.fallbackLocale ?? "en" }),
  );
  Facade.setFacadeApplication(app);
  return app;
};

const inScope = async (
  app: Container,
  user: { locale?: string } | undefined,
  callback: () => Promise<void>,
): Promise<void> => {
  const scope = app.createRequestScope();
  try {
    await (ContextApi.run(
      {
        request: {} as Request,
        user,
        modelBindings: {},
        container: scope,
      },
      callback,
    ) as unknown as Promise<void>);
  } finally {
    await scope.dispose();
  }
};

afterEach(() => {
  Facade.setFacadeApplication(undefined);
});

describe("LocaleMiddleware", () => {
  it("reads the query parameter before the user preference and Accept-Language", async () => {
    const app = setup();
    await inScope(app, { locale: "vi" }, async () => {
      await new LocaleMiddleware().handle(
        request({ locale: "ru" }, { "accept-language": "en;q=1" }),
        {} as Response,
        next,
      );
      expect(getLocale()).toBe("ru");
    });
  });

  it("uses the authenticated user preference, then Accept-Language", async () => {
    const app = setup();
    await inScope(app, { locale: "vi" }, async () => {
      await new LocaleMiddleware().handle(request({}, { "accept-language": "ru;q=1" }), {} as Response, next);
      expect(getLocale()).toBe("vi");
    });
    const second = setup();
    await inScope(second, undefined, async () => {
      await new LocaleMiddleware().handle(request({}, { "accept-language": "ru;q=1" }), {} as Response, next);
      expect(getLocale()).toBe("ru");
    });
  });

  it("orders Accept-Language by q-value, treats q=0 as an exclusion, and matches a base language", async () => {
    const app = setup();
    await inScope(app, undefined, async () => {
      await new LocaleMiddleware().handle(
        request({}, { "accept-language": "fr;q=1,vi-VN;q=0.8,en;q=0.5" }),
        {} as Response,
        next,
      );
      expect(getLocale()).toBe("vi");
    });
    const second = setup();
    await inScope(second, undefined, async () => {
      await new LocaleMiddleware().handle(request({}, { "accept-language": "vi;q=0,en;q=0.1" }), {} as Response, next);
      expect(getLocale()).toBe("en");
    });
  });

  it("skips a range with a malformed q instead of treating it as q=0 or q=1 (RFC 9110 §12.4.2)", async () => {
    const withFrench: LangCatalog = { ...catalog, fr: { messages: { greeting: "Bonjour {name}" } } };

    // An empty q is malformed: vi is ignored, not chosen at q=1, and en;q=0.5 wins
    const empty = setup();
    await inScope(empty, undefined, async () => {
      await new LocaleMiddleware().handle(request({}, { "accept-language": "vi;q=, en;q=0.5" }), {} as Response, next);
      expect(getLocale()).toBe("en");
    });

    // ... and it is not an exclusion either: a later vi-VN range still resolves to vi
    const notExcluded = setup();
    await inScope(notExcluded, undefined, async () => {
      await new LocaleMiddleware().handle(
        request({}, { "accept-language": "vi;q=, vi-VN;q=1, en;q=0.1" }),
        {} as Response,
        next,
      );
      expect(getLocale()).toBe("vi");
    });

    // q outside 0..1 is malformed: fr is ignored (a q=5 would otherwise outrank vi)
    const outOfRange = setup(withFrench);
    await inScope(outOfRange, undefined, async () => {
      await new LocaleMiddleware().handle(request({}, { "accept-language": "fr;q=5, vi" }), {} as Response, next);
      expect(getLocale()).toBe("vi");
    });

    // A non-numeric q or more than three decimals is malformed too: en is not silently q=1
    const malformed = setup();
    await inScope(malformed, undefined, async () => {
      await new LocaleMiddleware().handle(
        request({}, { "accept-language": "en;q=abc, fr;q=0.1234, vi;q=0.1" }),
        {} as Response,
        next,
      );
      expect(getLocale()).toBe("vi");
    });
  });

  it("never picks a catalog locale excluded by a q=0 range", async () => {
    const app = setup(
      {
        "en-US": { messages: { greeting: "Hello {name}" } },
        fr: { messages: { greeting: "Bonjour {name}" } },
      },
      { locale: "fr", fallbackLocale: "fr" },
    );
    await inScope(app, undefined, async () => {
      await new LocaleMiddleware().handle(
        request({}, { "accept-language": "en-US;q=0,en;q=1,fr;q=0.5" }),
        {} as Response,
        next,
      );
      expect(getLocale()).toBe("fr");
    });
  });

  it("leaves the shared default unchanged when the request has no container", async () => {
    setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await new LocaleMiddleware().handle(request({ locale: "vi" }), {} as Response, next);
      expect(getLocale()).toBe("en");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("no request container"));
    } finally {
      warn.mockRestore();
    }
  });

  it("setLocale() in a request without a container leaves the default alone, warns once, and the next request gets it", async () => {
    const app = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // A 0.5 route run inside ContextApi.run but not through RequestKernel: no request container to hold the locale
      await ContextApi.run({ request: {} as Request, modelBindings: {} }, () => {
        setLocale("vi");
        setLocale("ru");
      });
      expect(getLocale()).toBe("en");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("setLocale() has no request container"));

      // The next request still reads the app default, not what the container-less route tried to set
      await inScope(app, undefined, async () => {
        expect(getLocale()).toBe("en");
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("ignores an unsupported query locale and leaves the default when nothing matches", async () => {
    const app = setup();
    await inScope(app, undefined, async () => {
      await new LocaleMiddleware().handle(request({ locale: "fr" }, { "accept-language": "de" }), {} as Response, next);
      expect(getLocale()).toBe("en");
    });
  });

  it("keeps the locale in the request scope, isolated between concurrent requests (D6)", async () => {
    const app = setup();
    const first = app.createRequestScope();
    const second = app.createRequestScope();
    const delay = () => new Promise((resolve) => setTimeout(resolve, 10));
    try {
      await Promise.all([
        ContextApi.run(
          { request: {} as Request, user: { locale: "vi" }, modelBindings: {}, container: first },
          async () => {
            await new LocaleMiddleware().handle(request(), {} as Response, next);
            await delay();
            expect(getLocale()).toBe("vi");
          },
        ),
        ContextApi.run(
          { request: {} as Request, user: { locale: "ru" }, modelBindings: {}, container: second },
          async () => {
            await new LocaleMiddleware().handle(request(), {} as Response, next);
            await delay();
            expect(getLocale()).toBe("ru");
          },
        ),
      ]);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });
});
