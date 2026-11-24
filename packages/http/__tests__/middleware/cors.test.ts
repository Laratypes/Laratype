// H15 #164: CORS from app/config/cors.ts (docs/v1/http.md › CORS)
// Hono's `cors()` does the origin matching, the preflight and the headers; these tests cover the config, the boot-time
// refusals and where the middleware runs.
import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { Container, depsRegistry, setConfigs } from "@laratype/core";
import { HTTP_APP, UnauthorizedException } from "@laratype/support";
import { defineApi, defineContract, endpoint, errors } from "@laratype/contract";
import { Controller, mountConnInfo, RequestKernel, Response as ResponseSupport, ResponseKernel, Route } from "../../src/index";

const APP = "http://app.test";
const EVIL = "http://evil.test";
const ALLOW_ORIGIN = "Access-Control-Allow-Origin";

const posts = defineContract()({
  index: endpoint.get("/").response(z.object({ data: z.array(z.string()) })),
  show: endpoint.get("/:id").response(z.object({ id: z.number() })).throws(errors.notFound),
  store: endpoint.post("/").body(z.object({ title: z.string() })).response(z.object({ title: z.string() }), 201),
  limited: endpoint.get("/limited").response(z.object({ ok: z.boolean() })).throttle({ limit: 1, per: 60 }),
  boom: endpoint.get("/boom").response(z.object({ ok: z.boolean() })),
  // Declared: the X3 check fails a test on an undeclared 401, and this route exists to answer one
  secret: endpoint.get("/secret").response(z.object({ ok: z.boolean() })).throws(errors.unauthorized),
  vary: endpoint.get("/vary").response(z.object({ ok: z.boolean() })),
});
const postsApi = defineApi({ posts: { contract: posts, path: "/api/posts", scopes: [] } });

class PostsController extends Controller {
  index() { return { data: ["a"] }; }
  show() { throw errors.notFound(); }
  store() { return { title: "t" }; }
  limited() { return { ok: true }; }
  boom() { throw new Error("boom"); }
  secret() { throw new UnauthorizedException(); }
  vary() { return new ResponseSupport({ ok: true }, 200, { Vary: "Accept-Encoding" }); }
}

/** The example config the tests vary: `/api/*`, one allowed origin, credentials, an exposed header. */
const corsConfig = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  paths: ["/api/*"],
  origin: [APP],
  allowMethods: ["GET", "POST"],
  allowHeaders: ["Content-Type", "Authorization"],
  exposeHeaders: ["X-Request-Id"],
  maxAge: 600,
  credentials: true,
  ...overrides,
});

/** The config store `setConfigs` fills; deleted after each test so the next boot reads its own configs. */
const store = globalThis as { __laratype_configs?: unknown };

/** The getter the serving adapter registers: this test's request env carries the client address. */
const addressFromEnv = (c: Context) => ({ remote: { address: (c.env as { address?: string }).address } });

/**
 * An app booted like `sauf dev`: the config store is filled (what `ConfigLoadServiceProvider` does), then the kernels,
 * then the routes. Configs come first, so `RequestKernel.boot()` mounts CORS before the provider mounts its routes.
 */
const bootApp = (configs: Record<string, unknown> = { cors: corsConfig() }, loadConfigs = true): Hono => {
  if (!loadConfigs) delete store.__laratype_configs;
  else setConfigs(configs);
  const container = new Container({ deps: depsRegistry });
  const app = new Hono();
  mountConnInfo(app, addressFromEnv);
  container.instance(HTTP_APP, app);
  new RequestKernel(container).boot();
  new ResponseKernel(container).boot();
  Route.api(postsApi, (r) => [r.contract(posts, PostsController), r.get("/health", () => ({ ok: true }))]).mount(app);
  return app;
};

/** A request from `origin`: the `Origin` header, merged with the `init`'s own headers. */
const from = (app: Hono, path: string, origin = APP, init: RequestInit = {}): Promise<Response> =>
  app.request(path, {
    ...init,
    headers: { Origin: origin, ...(init.headers as Record<string, string> | undefined) },
  });

/** The origin a response echoes back, or `null` when it was refused. */
const allowOrigin = (response: Response): string | null => response.headers.get(ALLOW_ORIGIN);

/** The boot error of a config the framework refuses, as a message. */
const bootFailure = (cors: unknown): string => {
  try {
    bootApp({ cors });
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("the boot did not fail");
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete store.__laratype_configs;
  vi.restoreAllMocks();
});

describe("CORS preflight", () => {
  it("answers an allowed origin with a 204 and the configured headers", async () => {
    const response = await from(bootApp(), "/api/posts", APP, {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    });
    expect(response.status).toBe(204);
    expect(allowOrigin(response)).toBe(APP);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET,POST");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type,Authorization");
    expect(response.headers.get("Access-Control-Max-Age")).toBe("600");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    // Hono adds Vary for a non-wildcard origin, so a cache does not serve one origin's answer to another
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("answers nothing for an origin that is not listed", async () => {
    const response = await from(bootApp(), "/api/posts", EVIL, {
      method: "OPTIONS",
      headers: { "Access-Control-Request-Method": "POST" },
    });
    expect(response.status).toBe(204);
    expect(allowOrigin(response)).toBeNull();
  });
});

describe("CORS on an actual request", () => {
  it("sets the origin, the credentials and the exposed headers", async () => {
    const response = await from(bootApp(), "/api/posts");
    expect(response.status).toBe(200);
    expect(allowOrigin(response)).toBe(APP);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id");
    expect(await response.json()).toEqual({ data: ["a"] });
  });

  it("still runs the route for a refused origin: the browser enforces CORS, not the server", async () => {
    const response = await from(bootApp(), "/api/posts", EVIL);
    expect(response.status).toBe(200);
    expect(allowOrigin(response)).toBeNull();
    expect(await response.json()).toEqual({ data: ["a"] });
  });

  it("takes a single origin string as well as a list", async () => {
    const app = bootApp({ cors: corsConfig({ origin: APP }) });
    expect(allowOrigin(await from(app, "/api/posts"))).toBe(APP);
    expect(allowOrigin(await from(app, "/api/posts", EVIL))).toBeNull();
  });

  it("echoes '*' for every origin when origin is the string '*' and credentials are off", async () => {
    const app = bootApp({ cors: corsConfig({ origin: "*", credentials: false }) });
    const response = await from(app, "/api/posts", EVIL);
    expect(response.status).toBe(200);
    expect(allowOrigin(response)).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

describe("CORS headers on error responses", () => {
  it("401, 404, 422, a contract error and an unexpected 500 keep them", async () => {
    const app = bootApp();

    const unauthorized = await from(app, "/api/posts/secret");
    expect(unauthorized.status).toBe(401);
    expect(allowOrigin(unauthorized)).toBe(APP);

    // Hono's own 404: the path is in scope, no route matches it
    const notFound = await from(app, "/api/nothing");
    expect(notFound.status).toBe(404);
    expect(allowOrigin(notFound)).toBe(APP);

    // A contract error: the endpoint's declared 404
    const declared = await from(app, "/api/posts/9");
    expect(declared.status).toBe(404);
    expect(allowOrigin(declared)).toBe(APP);

    // The contract's 422
    const invalid = await from(app, "/api/posts", APP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: 1 }),
    });
    expect(invalid.status).toBe(422);
    expect(allowOrigin(invalid)).toBe(APP);

    // An error no route declares: the exception filter's generic 500
    const failure = await from(app, "/api/posts/boom");
    expect(failure.status).toBe(500);
    expect(allowOrigin(failure)).toBe(APP);
  });

  // H15 #164 + H29 #295: the outermost error scrub drops the headers it names and leaves the rest; the CORS headers
  // Hono sets before and after the throw survive, and `Vary` still names `Origin`
  it("keeps the CORS headers of a thrown contract error, a 4xx HTTPException and a plain Error", async () => {
    const app = bootApp();
    const throwing = (error: unknown) => (c: Context) => {
      c.header("ETag", '"v1"');
      throw error;
    };
    app.get("/api/contract", throwing(errors.notFound("No such post.")));
    app.get("/api/http", throwing(new HTTPException(401, { message: "Unauthorized" })));
    app.get("/api/plain", throwing(new Error("secret detail")));
    for (const [path, status] of [["/api/contract", 404], ["/api/http", 401], ["/api/plain", 500]] as const) {
      const response = await from(app, path);
      expect(response.status, path).toBe(status);
      expect(response.headers.get("Access-Control-Allow-Origin"), path).toBe(APP);
      expect(response.headers.get("Access-Control-Allow-Credentials"), path).toBe("true");
      expect(response.headers.get("Access-Control-Expose-Headers"), path).toBe("X-Request-Id");
      const vary = (response.headers.get("Vary") ?? "").split(",").map((token) => token.trim().toLowerCase());
      expect(vary, path).toContain("origin");
      // the scrub still dropped what was set before the throw, and the error is not cached
      expect(response.headers.get("ETag"), path).toBeNull();
      expect(response.headers.get("Cache-Control"), path).toBe("no-store");
    }
  });

  it("the 413 of the default body limit keeps them", async () => {
    const app = bootApp({ cors: corsConfig(), http: { bodyLimit: { json: 20 } } });
    const response = await from(app, "/api/posts", APP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(100) }),
    });
    expect(response.status).toBe(413);
    expect(allowOrigin(response)).toBe(APP);
  });

  it("the 429 of the contract's throttle keeps them (#319)", async () => {
    const app = bootApp();
    // The env of a request from `address`, read by the registered getter
    const client = (address: string) => ({ address });
    const first = await app.request("/api/posts/limited", { headers: { Origin: APP } }, client("203.0.113.20"));
    expect(first.status).toBe(200);
    const limited = await app.request("/api/posts/limited", { headers: { Origin: APP } }, client("203.0.113.20"));
    expect(limited.status).toBe(429);
    expect(allowOrigin(limited)).toBe(APP);
    expect(limited.headers.get("Retry-After")).not.toBeNull();
  });
});

describe("CORS Vary", () => {
  /** The response's `Vary` tokens, lowercased, so a test names `Origin` in any case. */
  const varyTokens = (response: Response): string[] =>
    (response.headers.get("Vary") ?? "").split(",").map((token) => token.trim().toLowerCase()).filter(Boolean);

  /**
   * `Origin` is there exactly once. Hono 4.9.6 builds `Vary` from the request and this wrapper appends `Origin`; Hono
   * 4.10.3+ appends it itself and the wrapper is a no-op. The assertion holds on both, so a Hono bump keeps the suite.
   */
  const expectOrigin = (response: Response) => {
    const tokens = varyTokens(response);
    expect(tokens).toContain("origin");
    expect(tokens.filter((token) => token === "origin")).toHaveLength(1);
  };

  it("keeps Origin on an actual 200 when the request sends its own Vary", async () => {
    const response = await from(bootApp(), "/api/posts", APP, { headers: { Vary: "x" } });
    expect(response.status).toBe(200);
    expect(allowOrigin(response)).toBe(APP);
    expectOrigin(response);
  });

  it("keeps Origin on a contract error when the request sends its own Vary", async () => {
    const response = await from(bootApp(), "/api/posts/9", APP, { headers: { Vary: "x" } });
    expect(response.status).toBe(404);
    expect(allowOrigin(response)).toBe(APP);
    expectOrigin(response);
  });

  it("keeps Origin on the preflight when the request sends its own Vary", async () => {
    const response = await from(bootApp(), "/api/posts", APP, {
      method: "OPTIONS",
      headers: { Vary: "x", "Access-Control-Request-Method": "POST" },
    });
    expect(response.status).toBe(204);
    expect(allowOrigin(response)).toBe(APP);
    expectOrigin(response);
  });

  it("appends Origin to a handler's own Vary, keeping both tokens", async () => {
    const response = await from(bootApp(), "/api/posts/vary", APP, { headers: { Vary: "x" } });
    expect(response.status).toBe(200);
    expect(varyTokens(response)).toContain("accept-encoding");
    expectOrigin(response);
  });

  it("keeps a raw Response's own Vary and appends Origin", async () => {
    const app = bootApp();
    // A raw Hono route, after the mounted CORS middleware: the response is the handler's, not one the context built
    app.get(
      "/api/raw",
      () => new Response("u", { headers: { Vary: "Cookie, Authorization", "Cache-Control": "public, max-age=60" } }),
    );
    const response = await from(app, "/api/raw");
    expect(response.status).toBe(200);
    expect(allowOrigin(response)).toBe(APP);
    expect(response.headers.get("Vary")).toBe("Cookie, Authorization, Origin");
  });

  it("does not duplicate Origin when the request already lists it", async () => {
    expectOrigin(await from(bootApp(), "/api/posts", APP, { headers: { Vary: "origin" } }));
  });
});

describe("CORS paths", () => {
  it("scopes the middleware: /api/* is covered, an ad-hoc route outside it is not", async () => {
    const app = bootApp();
    expect(allowOrigin(await from(app, "/api/posts"))).toBe(APP);
    const outside = await from(app, "/health");
    expect(outside.status).toBe(200);
    expect(allowOrigin(outside)).toBeNull();
  });

  it("defaults to every path without a paths key", async () => {
    const app = bootApp({ cors: corsConfig({ paths: undefined }) });
    expect(allowOrigin(await from(app, "/health"))).toBe(APP);
  });

  it("runs cors once when patterns overlap", async () => {
    const calls: string[] = [];
    const app = bootApp({
      cors: corsConfig({
        paths: ["/api/*", "/api/posts/*"],
        origin: (origin: string) => {
          calls.push(origin);
          return origin === APP ? origin : null;
        },
      }),
    });
    expect(allowOrigin(await from(app, "/api/posts"))).toBe(APP);
    // A mount per pattern would run the middleware twice; the origin function is called once per pass
    expect(calls).toEqual([APP]);
  });
});

describe("CORS without a config", () => {
  it("mounts no CORS without a cors key, and answers no preflight", async () => {
    const app = bootApp({});
    const response = await from(app, "/api/posts");
    expect(response.status).toBe(200);
    expect(allowOrigin(response)).toBeNull();
    // No OPTIONS route, no CORS middleware: Hono's 404
    expect((await from(app, "/api/posts", APP, { method: "OPTIONS" })).status).toBe(404);
  });

  it("boots without a config store at all (a bare kernel)", async () => {
    const app = bootApp({}, false);
    const response = await from(app, "/api/posts");
    expect(response.status).toBe(200);
    expect(allowOrigin(response)).toBeNull();
  });

  it("fails the boot when the config read throws", () => {
    // A `cors` value read errors (a getter, or a file that failed to load): only the missing store means "no CORS"
    const configs: Record<string, unknown> = {};
    Object.defineProperty(configs, "cors", {
      enumerable: true,
      get() {
        throw new Error("app/config/cors.ts failed to load");
      },
    });
    expect(() => bootApp(configs)).toThrow("app/config/cors.ts failed to load");
  });
});

describe("an invalid app/config/cors.ts fails the boot", () => {
  const CONFIG = "app/config/cors.ts";
  const header = (count: number) => `[@laratype/http] Invalid CORS config (${CONFIG}), ${count} problem`;

  it("lists every problem in one error", () => {
    const message = bootFailure(corsConfig({ origin: "*", credentials: true, maxAge: -1 }));
    expect(message).toBe(
      `${header(2)}s:\n` +
        "- maxAge: expected a whole number of seconds, 0 or more, got -1\n" +
        "- credentials: true cannot pair with origin '*'; list the origins instead",
    );
  });

  it("reports a file that is not defineConfig({ ... })", () => {
    expect(bootFailure(false)).toBe(`${header(1)}:\n- expected defineConfig({ ... }), got false`);
  });

  it("reports the origin and the list values", () => {
    const pathExpected = "paths: expected a non-empty array of path patterns ('*' or a path starting with '/'), got []";
    const pair = "credentials: true cannot pair with origin '*'; list the origins instead";
    const cases: Array<[unknown, string]> = [
      [corsConfig({ origin: undefined }), "origin: required; name the origins, or '*'"],
      [corsConfig({ origin: [] }), "origin: expected '*' or an origin string, a list of them, or a function, got []"],
      [corsConfig({ origin: 42 }), "origin: expected '*' or an origin string, a list of them, or a function, got 42"],
      [corsConfig({ origin: [APP, 7] }), "origin[1]: expected a non-empty origin string, got 7"],
      [corsConfig({ origin: "" }), 'origin: expected a non-empty origin string, got ""'],
      [corsConfig({ origin: "null" }), "origin: 'null' allows sandboxed and file: pages; list real origins"],
      [
        corsConfig({ origin: [APP, "null"] }),
        "origin[1]: 'null' allows sandboxed and file: pages; list real origins",
      ],
      [
        corsConfig({ origin: "http://app.test/" }),
        'origin: expected a serialized origin (http(s)://host[:port]), got "http://app.test/"',
      ],
      [
        corsConfig({ origin: ["http://app.test/api"] }),
        'origin[0]: expected a serialized origin (http(s)://host[:port]), got "http://app.test/api"',
      ],
      [
        corsConfig({ origin: "ftp://app.test" }),
        'origin: expected a serialized origin (http(s)://host[:port]), got "ftp://app.test"',
      ],
      [corsConfig({ paths: [] }), pathExpected],
      [
        corsConfig({ paths: ["api/*"] }),
        "paths[0]: expected a path pattern ('*' or a path starting with '/'), got \"api/*\"",
      ],
      [
        corsConfig({ allowMethods: "GET" }),
        'allowMethods: expected an array of HTTP method names or a function, got "GET"',
      ],
      [corsConfig({ allowMethods: ["GET", ""] }), 'allowMethods[1]: expected an HTTP method name, got ""'],
      [
        corsConfig({ allowHeaders: "Content-Type" }),
        'allowHeaders: expected an array of header names, got "Content-Type"',
      ],
      [corsConfig({ exposeHeaders: [""] }), 'exposeHeaders[0]: expected a header name, got ""'],
      [corsConfig({ maxAge: 1.5 }), "maxAge: expected a whole number of seconds, 0 or more, got 1.5"],
      [corsConfig({ credentials: "true" }), 'credentials: expected a boolean, got "true"'],
      [corsConfig({ origin: "*", credentials: true }), pair],
      [
        corsConfig({ origin: [APP, "*"], credentials: true }),
        "origin[1]: '*' cannot be a list entry; set origin: '*' for every origin, or list them",
      ],
      [
        corsConfig({ credential: true }),
        "'credential': unknown key " +
          "(expected paths, origin, allowMethods, allowHeaders, exposeHeaders, maxAge, credentials)",
      ],
    ];
    for (const [cors, problem] of cases) {
      expect(bootFailure(cors), problem).toBe(`${header(1)}:\n- ${problem}`);
    }
  });
});
