// H45 #342: the 0.5 response decides JSON by the value's shape, sends every non-string value as application/json and
// marks those responses nosniff
import "reflect-metadata";
import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { Container, depsRegistry } from "@laratype/core";
import { HTTP_APP } from "@laratype/support";
import { defineApi, defineContract, endpoint } from "@laratype/contract";
import {
  Controller, JsonResource, RequestKernel, Response as LaratypeResponse, ResponseKernel, Route,
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

/** A 0.5 controller method answering `content`, as the 0.5 routes mount one. */
const respond = async (content: unknown) => {
  class Echo extends Controller {
    index() { return content; }
  }
  const app = bootApp();
  app.get("/echo", RequestKernel.handle({ method: "get", path: "/echo", controller: [Echo as never, "index"] }));
  return app.request("/echo");
};

beforeAll(() => {
  globalThis.__laratype_route_model_bindings = {};
});

/** The group `parseBody({ dot: true })` builds for `profile.name=a`: a null-prototype object. */
const profileGroup = () => {
  const group: Record<string, unknown> = Object.create(null);
  group.name = "a";
  return group;
};

describe("Response.shouldBeJson", () => {
  it("takes a plain object as JSON", () => {
    expect(new LaratypeResponse({ name: "a" }).shouldBeJson()).toBe(true);
  });

  it("takes an array as JSON", () => {
    expect(new LaratypeResponse([{ name: "a" }]).shouldBeJson()).toBe(true);
  });

  it("takes an Array subclass as JSON", () => {
    class Names extends Array<string> {}
    expect(new LaratypeResponse(new Names("a")).shouldBeJson()).toBe(true);
  });

  it("takes parseBody's null-prototype objects as JSON", () => {
    expect(new LaratypeResponse(profileGroup()).shouldBeJson()).toBe(true);
  });

  it("takes an object with an own constructor key as JSON", () => {
    expect(new LaratypeResponse({ name: "a", constructor: "text" }).shouldBeJson()).toBe(true);
  });

  it("takes no content as no JSON body", () => {
    expect(new LaratypeResponse(null).shouldBeJson()).toBe(false);
    expect(new LaratypeResponse(undefined).shouldBeJson()).toBe(false);
  });
});

describe("the 0.5 response JSON body", () => {
  it("sends a plain object as JSON", async () => {
    const response = await respond({ name: "a" });
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ name: "a" });
  });

  it("sends an array as JSON", async () => {
    const response = await respond([{ name: "a" }]);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual([{ name: "a" }]);
  });

  it("sends an Array subclass as JSON", async () => {
    class Names extends Array<string> {}
    const response = await respond(new Names("a"));
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual(["a"]);
  });

  it("sends parseBody's null-prototype objects as JSON", async () => {
    const response = await respond(profileGroup());
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ name: "a" });
  });

  it("sends an object with an own constructor key as JSON", async () => {
    const response = await respond({ name: "a", constructor: "text" });
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ name: "a", constructor: "text" });
  });

  it("sends a value of another prototype as JSON, never as HTML", async () => {
    class Point { x = 1; y = 2; }
    const response = await respond(new Point());
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ x: 1, y: 2 });
  });

  it("marks a JSON response nosniff", async () => {
    const response = await respond({ name: "a" });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("the 0.5 response Model and JsonResource detection", () => {
  class Item {
    static dataSource = { name: "default" };
    name = "a";
  }

  it("takes a model instance as JSON, from its class", () => {
    const response = new LaratypeResponse(new Item());
    expect(response.isModel()).toEqual(Item.dataSource);
    expect(response.shouldBeJson()).toBe(true);
  });

  it("sends a model instance as JSON", async () => {
    const response = await respond(new Item());
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ name: "a" });
  });

  it("reads no own constructor key of the value as a model", () => {
    const response = new LaratypeResponse({ name: "a", constructor: { dataSource: { name: "default" } } });
    expect(response.isModel()).toBeUndefined();
    expect(response.shouldBeJson()).toBe(true);
  });

  it("sends a JsonResource as JSON, unwrapped", async () => {
    const response = await respond(new JsonResource({ name: "a" }));
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ name: "a" });
  });
});

describe("the 0.5 response of a urlencoded body group", () => {
  it("answers the nested group of a urlencoded body as JSON", async () => {
    const app = bootApp();
    Route.api(appApi, (r) => [
      r.contract(health, HealthController),
      r.post("/profile", (req) => req.input("profile")),
    ]).mount(app);
    const response = await app.request("/profile", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "profile.name=a",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({ name: "a" });
  });
});
