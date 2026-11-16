// H15 #164: CORS from app/config/cors.ts (docs/v1/http.md › CORS)
// Hono's `cors()` does the origin matching, the preflight and the headers; these tests cover the config, the boot-time
// refusals and where the middleware runs.
import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import { Container, depsRegistry, setConfigs } from "@laratype/core";
import { HTTP_APP, UnauthorizedException } from "@laratype/support";
import { defineApi, defineContract, endpoint, errors } from "@laratype/contract";
import { Controller, RequestKernel, ResponseKernel, Route } from "../../src/index";

const APP = "http://app.test";
const EVIL = "http://evil.test";

const posts = defineContract()({
  index: endpoint.get("/").response(z.object({ data: z.array(z.string()) })),
  show: endpoint.get("/:id").response(z.object({ id: z.number() })).throws(errors.notFound),
  store: endpoint.post("/").body(z.object({ title: z.string() })).response(z.object({ title: z.string() }), 201),
  limited: endpoint.get("/limited").response(z.object({ ok: z.boolean() })).throttle({ limit: 1, per: 60 }),
  boom: endpoint.get("/boom").response(z.object({ ok: z.boolean() })),
  secret: endpoint.get("/secret").response(z.object({ ok: z.boolean() })),
});
const postsApi = defineApi({ posts: { contract: posts, path: "/api/posts", scopes: [] } });

class PostsController extends Controller {
  index() { return { data: ["a"] }; }
  show() { throw errors.notFound(); }
  store() { return { title: "t" }; }
  limited() { return { ok: true }; }
  boom() { throw new Error("boom"); }
  secret() { throw new UnauthorizedException(); }
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

/**
 * An app booted like `sauf dev`: the config store is filled (what `ConfigLoadServiceProvider` does), then the kernels,
 * then the routes. Configs come first, so `RequestKernel.boot()` mounts CORS before the provider mounts its routes.
 */
const bootApp = (configs: Record<string, unknown> = { cors: corsConfig() }, loadConfigs = true): Hono => {
  if (!loadConfigs) delete store.__laratype_configs;
  else setConfigs(configs);
  const container = new Container({ deps: depsRegistry });
  const app = new Hono();
  container.instance(HTTP_APP, app);
  new RequestKernel(container).boot();
  new ResponseKernel(container).boot();
  Route.api(postsApi, (r) => [r.contract(posts, PostsController), r.get("/health", () => ({ ok: true }))]).mount(app);
  return app;
};

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

describe("preflight", () => {
  it("answers an allowed origin with a 204 and the configured headers", async () => {
    const response = await bootApp().request("/api/posts", {
      method: "OPTIONS",
      headers: { Origin: APP, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET,POST");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type,Authorization");
    expect(response.headers.get("Access-Control-Max-Age")).toBe("600");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    // Hono adds Vary for a non-wildcard origin, so a cache does not serve one origin's answer to another
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("answers nothing for an origin that is not listed: no Access-Control-Allow-Origin", async () => {
    const response = await bootApp().request("/api/posts", {
      method: "OPTIONS",
      headers: { Origin: EVIL, "Access-Control-Request-Method": "POST" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("actual request", () => {
  it("sets the origin, the credentials and the exposed headers", async () => {
    const response = await bootApp().request("/api/posts", { headers: { Origin: APP } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe("X-Request-Id");
    expect(await response.json()).toEqual({ data: ["a"] });
  });

  it("still runs the route for a refused origin, without the header: the browser enforces CORS, not the server", async () => {
    const response = await bootApp().request("/api/posts", { headers: { Origin: EVIL } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await response.json()).toEqual({ data: ["a"] });
  });

  it("takes a single origin string as well as a list", async () => {
    const app = bootApp({ cors: corsConfig({ origin: APP }) });
    expect((await app.request("/api/posts", { headers: { Origin: APP } })).headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect((await app.request("/api/posts", { headers: { Origin: EVIL } })).headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("error responses", () => {
  it("401, 404, 422 and an unexpected 500 keep the headers", async () => {
    const app = bootApp();

    const unauthorized = await app.request("/api/posts/secret", { headers: { Origin: APP } });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("Access-Control-Allow-Origin")).toBe(APP);

    // Hono's own 404: the path is in scope, no route matches it
    const notFound = await app.request("/api/nothing", { headers: { Origin: APP } });
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("Access-Control-Allow-Origin")).toBe(APP);

    // A contract error: the endpoint's declared 404
    const declared = await app.request("/api/posts/9", { headers: { Origin: APP } });
    expect(declared.status).toBe(404);
    expect(declared.headers.get("Access-Control-Allow-Origin")).toBe(APP);

    // The contract's 422
    const invalid = await app.request("/api/posts", {
      method: "POST",
      headers: { Origin: APP, "Content-Type": "application/json" },
      body: JSON.stringify({ title: 1 }),
    });
    expect(invalid.status).toBe(422);
    expect(invalid.headers.get("Access-Control-Allow-Origin")).toBe(APP);

    // An error no route declares: the exception filter's generic 500
    const failure = await app.request("/api/posts/boom", { headers: { Origin: APP } });
    expect(failure.status).toBe(500);
    expect(failure.headers.get("Access-Control-Allow-Origin")).toBe(APP);
  });

  it("the 413 of the default body limit keeps them", async () => {
    const app = bootApp({ cors: corsConfig(), http: { bodyLimit: { json: 20 } } });
    const response = await app.request("/api/posts", {
      method: "POST",
      headers: { Origin: APP, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(100) }),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
  });

  it("the 429 of the contract's throttle keeps them (#319)", async () => {
    const app = bootApp();
    // The Bun adapter's env: `request.ip()` reads `server.requestIP()`
    const from = (address: string) => ({ requestIP: () => ({ address }) });
    expect((await app.request("/api/posts/limited", { headers: { Origin: APP } }, from("203.0.113.20"))).status).toBe(200);
    const limited = await app.request("/api/posts/limited", { headers: { Origin: APP } }, from("203.0.113.20"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(limited.headers.get("Retry-After")).not.toBeNull();
  });
});

describe("paths", () => {
  it("scopes the middleware: /api/* is covered, an ad-hoc route outside it is not", async () => {
    const app = bootApp();
    expect((await app.request("/api/posts", { headers: { Origin: APP } })).headers.get("Access-Control-Allow-Origin")).toBe(APP);
    const outside = await app.request("/health", { headers: { Origin: APP } });
    expect(outside.status).toBe(200);
    expect(outside.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("defaults to every path without a paths key", async () => {
    const app = bootApp({ cors: corsConfig({ paths: undefined }) });
    expect((await app.request("/health", { headers: { Origin: APP } })).headers.get("Access-Control-Allow-Origin")).toBe(APP);
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
    const response = await app.request("/api/posts", { headers: { Origin: APP } });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    // A mount per pattern would run the middleware twice; the origin function is called once per pass
    expect(calls).toEqual([APP]);
  });
});

describe("no config", () => {
  it("mounts no CORS without a cors key, and answers no preflight", async () => {
    const app = bootApp({});
    const response = await app.request("/api/posts", { headers: { Origin: APP } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    // No OPTIONS route, no CORS middleware: Hono's 404
    expect((await app.request("/api/posts", { method: "OPTIONS", headers: { Origin: APP } })).status).toBe(404);
  });

  it("boots without a config store at all (a bare kernel)", async () => {
    const app = bootApp({}, false);
    const response = await app.request("/api/posts", { headers: { Origin: APP } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("an invalid app/config/cors.ts fails the boot", () => {
  const CONFIG = "app/config/cors.ts";

  it("lists every problem in one error", () => {
    expect(bootFailure(corsConfig({ origin: "*", credentials: true, maxAge: -1 }))).toBe(
      `[@laratype/http] Invalid CORS config (${CONFIG}), 2 problems:\n` +
        "- maxAge: expected a whole number of seconds, 0 or more, got -1\n" +
        "- credentials: true cannot pair with origin '*'; list the origins instead",
    );
  });

  it("reports a file that is not defineConfig({ ... })", () => {
    expect(bootFailure(false)).toBe(
      `[@laratype/http] Invalid CORS config (${CONFIG}), 1 problem:\n- expected defineConfig({ ... }), got false`,
    );
  });

  it("reports the origin and the list values", () => {
    const cases: Array<[unknown, string]> = [
      [corsConfig({ origin: undefined }), "origin: required; name the origins, or '*'"],
      [corsConfig({ origin: [] }), "origin: expected '*' or an origin string, a list of them, or a function, got []"],
      [corsConfig({ origin: 42 }), "origin: expected '*' or an origin string, a list of them, or a function, got 42"],
      [corsConfig({ origin: [APP, 7] }), "origin[1]: expected a non-empty origin string, got 7"],
      [corsConfig({ origin: "" }), 'origin: expected a non-empty origin string, got ""'],
      [corsConfig({ paths: [] }), "paths: expected a non-empty array of path patterns ('*' or a path starting with '/'), got []"],
      [corsConfig({ paths: ["api/*"] }), "paths[0]: expected a path pattern ('*' or a path starting with '/'), got \"api/*\""],
      [corsConfig({ allowMethods: "GET" }), 'allowMethods: expected an array of HTTP method names or a function, got "GET"'],
      [corsConfig({ allowMethods: ["GET", ""] }), 'allowMethods[1]: expected an HTTP method name, got ""'],
      [corsConfig({ allowHeaders: "Content-Type" }), 'allowHeaders: expected an array of header names, got "Content-Type"'],
      [corsConfig({ exposeHeaders: [""] }), 'exposeHeaders[0]: expected a header name, got ""'],
      [corsConfig({ maxAge: 1.5 }), "maxAge: expected a whole number of seconds, 0 or more, got 1.5"],
      [corsConfig({ credentials: "true" }), 'credentials: expected a boolean, got "true"'],
      [corsConfig({ origin: "*", credentials: true }), "credentials: true cannot pair with origin '*'; list the origins instead"],
      [corsConfig({ origin: [APP, "*"], credentials: true }), "credentials: true cannot pair with origin '*'; list the origins instead"],
      [
        corsConfig({ credential: true }),
        "'credential': unknown key (expected paths, origin, allowMethods, allowHeaders, exposeHeaders, maxAge, credentials)",
      ],
    ];
    for (const [cors, problem] of cases) {
      expect(bootFailure(cors), problem).toBe(`[@laratype/http] Invalid CORS config (${CONFIG}), 1 problem:\n- ${problem}`);
    }
  });
});
