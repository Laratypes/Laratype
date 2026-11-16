import { describe, expectTypeOf, it } from "vitest";
import { defineConfig } from "@laratype/core";
import type { CorsConfig } from "../../src/index";

describe("CorsConfig", () => {
  it("accepts readonly lists, Hono's async origin function and the Hono options", () => {
    const config = defineConfig<CorsConfig>({
      paths: ["/api/*"] as const,
      origin: async (origin) => (origin === "https://app.test" ? origin : null),
      allowMethods: ["GET", "POST"] as const,
      allowHeaders: ["Content-Type"] as const,
      exposeHeaders: ["X-Request-Id"] as const,
      maxAge: 600,
      credentials: true,
    });
    expectTypeOf(config.paths).toEqualTypeOf<readonly string[] | undefined>();
    expectTypeOf(config.origin).toEqualTypeOf<CorsConfig["origin"]>();
    expectTypeOf(config.maxAge).toEqualTypeOf<number | undefined>();
  });

  it("rejects an origin that is not a string, a list of strings or a function", () => {
    // @ts-expect-error an origin is a string, a list of strings, or a function
    defineConfig<CorsConfig>({ origin: 42 });
  });

  it("rejects an unknown key", () => {
    // @ts-expect-error the key is `credentials`; `credential` is not a CorsConfig key
    defineConfig<CorsConfig>({ origin: "*", credential: true });
  });
});
