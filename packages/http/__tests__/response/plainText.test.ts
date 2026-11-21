// H41 #336: a string returned from a handler is sent as text/plain, never as unescaped HTML; HTML needs an explicit
// Content-Type on a `Response`. The one rule is in ResponseKernel.resolveResponse, so it covers ad-hoc routes, 0.5
// controller methods and 0.5 route middleware alike
import "reflect-metadata";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Container, depsRegistry } from "@laratype/core";
import { HTTP_APP } from "@laratype/support";
import { defineApi, defineContract, endpoint } from "@laratype/contract";
import {
  Controller, Middleware, RequestKernel, Response as LaratypeResponse, ResponseKernel, Route,
} from "../../src/index";

const anything = { "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) } } as const;
const health = defineContract()({ index: endpoint.get("/").response(anything) });
const appApi = defineApi({ health: { contract: health, path: "/api/health", scopes: [] } });

class HealthController extends Controller {
  index() { return { ok: true }; }
}

/** An app booted like `sauf dev`: RequestKernel puts the container on each request, ResponseKernel handles errors. */
const bootApp = () => {
  const container = new Container({ deps: depsRegistry });
  const app = new Hono();
  container.instance(HTTP_APP, app);
  new RequestKernel(container).boot();
  new ResponseKernel(container).boot();
  return app;
};

beforeAll(() => {
  globalThis.__laratype_route_model_bindings = {};
});

describe("the 0.5 response of a string", () => {
  it("sends an ad-hoc route's string as text/plain, with the reflected body unchanged", async () => {
    const app = bootApp();
    Route.api(appApi, (r) => [
      r.contract(health, HealthController),
      r.get("/hello/:name", (req, { name }) => `Hi ${name}`),
    ]).mount(app);
    const response = await app.request(`/hello/${encodeURIComponent("<script>alert(1)</script>")}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    // An old browser must not sniff the text as HTML and run the reflected script
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("Hi <script>alert(1)</script>");
  });

  it("sends a 0.5 controller method's string as text/plain", async () => {
    class Echo extends Controller {
      index() { return "<script>alert(1)</script>"; }
    }
    const app = bootApp();
    app.get("/legacy", RequestKernel.handle({ method: "get", path: "/legacy", controller: [Echo as never, "index"] }));
    const response = await app.request("/legacy");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("<script>alert(1)</script>");
  });

  it("keeps a 0.5 controller method's explicit text/html Response", async () => {
    class Page extends Controller {
      index() { return new LaratypeResponse("<b>hi</b>").setContentType("text/html; charset=utf-8"); }
    }
    const app = bootApp();
    app.get("/page", RequestKernel.handle({ method: "get", path: "/page", controller: [Page as never, "index"] }));
    const response = await app.request("/page");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("<b>hi</b>");
  });

  it("sends a 0.5 route middleware's string as text/plain", async () => {
    class Guard extends Middleware {
      async handle() { return "blocked <script>alert(1)</script>"; }
    }
    const app = bootApp();
    app.get("/legacy", RequestKernel.handle({
      method: "get",
      path: "/legacy",
      middleware: [Guard],
      controller: [HealthController as never, "index"],
    }));
    const response = await app.request("/legacy");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("blocked <script>alert(1)</script>");
  });

  it("sends the string of a contract route's non-2xx 0.5 Response as text/plain", async () => {
    class Deny extends Middleware {
      async handle() { return new LaratypeResponse("Forbidden", 401); }
    }
    const app = bootApp();
    Route.api(appApi, (r) => [r.middleware(Deny).contract(health, HealthController)]).mount(app);
    const response = await app.request("/api/health");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("Forbidden");
  });

  it("keeps a contract route's 0.5 redirect as it is", async () => {
    class Moved extends Middleware {
      async handle() { return new LaratypeResponse("ignored", 302).redirect("/login"); }
    }
    const app = bootApp();
    Route.api(appApi, (r) => [r.middleware(Moved).contract(health, HealthController)]).mount(app);
    const response = await app.request("/api/health");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
    expect(await response.text()).toBe("");
  });
});

describe("the explicit content type of a string", () => {
  it("keeps a text/html Content-Type set on a Response, the migration for an HTML answer", async () => {
    const app = bootApp();
    Route.api(appApi, (r) => [
      r.contract(health, HealthController),
      r.get("/html", () => new LaratypeResponse("<b>hi</b>").setContentType("text/html; charset=utf-8")),
    ]).mount(app);
    const response = await app.request("/html");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    // nosniff is not only for the default type: an explicit one keeps it too
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("<b>hi</b>");
  });

  it("sets nosniff even when a Response sets an explicit non-HTML type", async () => {
    const app = bootApp();
    Route.api(appApi, (r) => [
      r.contract(health, HealthController),
      r.get("/csv", () => new LaratypeResponse("a,b", 200, { "Content-Type": "text/csv" })),
    ]).mount(app);
    const response = await app.request("/csv");
    expect(response.headers.get("content-type")).toBe("text/csv");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("ignores a Content-Type value that is not a string, instead of throwing", async () => {
    const app = bootApp();
    Route.api(appApi, (r) => [
      r.contract(health, HealthController),
      // the 0.5 header store takes anything; a number and a list are not a type
      r.get("/number", () => new LaratypeResponse("42", 200, { "Content-Type": 42 as unknown as string })),
      r.get("/list", () => new LaratypeResponse("a,b", 200, { "Content-Type": ["text/csv"] as unknown as string })),
    ]).mount(app);
    for (const path of ["/number", "/list"]) {
      const response = await app.request(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toBe("text/plain; charset=utf-8");
      expect(response.headers.get("x-content-type-options"), path).toBe("nosniff");
    }
  });

  it("keeps a Content-Type set with another case, and the Response's status and headers", async () => {
    const app = bootApp();
    Route.api(appApi, (r) => [
      r.contract(health, HealthController),
      r.get("/csv", () => new LaratypeResponse("a,b", 201, { "content-type": "text/csv", "X-Request-Id": "7" })),
    ]).mount(app);
    const response = await app.request("/csv");
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("text/csv");
    expect(response.headers.get("x-request-id")).toBe("7");
    expect(await response.text()).toBe("a,b");
  });

  it("treats a blank Content-Type as no type: text/plain with nosniff", async () => {
    const app = bootApp();
    Route.api(appApi, (r) => [
      r.contract(health, HealthController),
      r.get("/blank", () => new LaratypeResponse("<script>alert(1)</script>").setContentType("  ")),
    ]).mount(app);
    const response = await app.request("/blank");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("<script>alert(1)</script>");
  });

  it("ignores an inherited Content-Type, which must not opt a string into HTML", async () => {
    const headers: Record<string, string> = Object.create({ "Content-Type": "text/html" });
    const app = bootApp();
    Route.api(appApi, (r) => [
      r.contract(health, HealthController),
      r.get("/inherited", () => new LaratypeResponse("<script>alert(1)</script>", undefined, headers)),
    ]).mount(app);
    const response = await app.request("/inherited");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("<script>alert(1)</script>");
  });
});

describe("the other bodies of the 0.5 response", () => {
  it("still sends a returned object as JSON", async () => {
    const app = bootApp();
    Route.api(appApi, (r) => [
      r.contract(health, HealthController),
      r.get("/json", () => ({ ok: true })),
    ]).mount(app);
    const response = await app.request("/json");
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("still sends an object as JSON when the Response sets another Content-Type", async () => {
    const app = bootApp();
    Route.api(appApi, (r) => [
      r.contract(health, HealthController),
      r.get("/json-html", () => new LaratypeResponse({ ok: true }, undefined, { "Content-Type": "text/html" })),
    ]).mount(app);
    const response = await app.request("/json-html");
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("keeps the status and headers of a Response around a string body", async () => {
    const app = bootApp();
    Route.api(appApi, (r) => [
      r.contract(health, HealthController),
      r.get("/queued", () => new LaratypeResponse("queued", 202, { "X-Job": "7" })),
    ]).mount(app);
    const response = await app.request("/queued");
    expect(response.status).toBe(202);
    expect(response.headers.get("x-job")).toBe("7");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe("queued");
  });

  it("logs no error for a string on an ad-hoc route", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const app = bootApp();
      Route.api(appApi, (r) => [
        r.contract(health, HealthController),
        r.get("/ok", () => "ok"),
      ]).mount(app);
      expect(await (await app.request("/ok")).text()).toBe("ok");
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});
