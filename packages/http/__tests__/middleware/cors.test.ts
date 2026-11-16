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
const ALLOW_ORIGIN = "Access-Control-Allow-Origin";

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
    // The Bun adapter's env: `request.ip()` reads `server.requestIP()`
    const client = (address: string) => ({ requestIP: () => ({ address }) });
    const first = await app.request("/api/posts/limited", { headers: { Origin: APP } }, client("203.0.113.20"));
    expect(first.status).toBe(200);
    const limited = await app.request("/api/posts/limited", { headers: { Origin: APP } }, client("203.0.113.20"));
    expect(limited.status).toBe(429);
    expect(allowOrigin(limited)).toBe(APP);
    expect(limited.headers.get("Retry-After")).not.toBeNull();
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
