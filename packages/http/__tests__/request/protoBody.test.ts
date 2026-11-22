// B30 #410: a request body's `__proto__`, `constructor` and `prototype` keys are data, never a prototype. The pipeline
// builds every form group with `Object.create(null)` and mirrors Hono 4.13.17's `__proto__.` guard; a JSON body keeps
// `JSON.parse`'s own data key. Each case checks that a value submitted under such a key reaches no prototype.
import "reflect-metadata";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod";
import { Container, depsRegistry } from "@laratype/core";
import { HTTP_APP } from "@laratype/support";
import { defineApi, defineContract, endpoint } from "@laratype/contract";
import { Controller, RequestKernel, ResponseKernel, Route } from "../../src/index";
import type { AdHocRouteParams, Ctx, Request as LaratypeRequest } from "../../src/index";
import { toDotFields } from "../../src/request/input";

/** An app booted like `sauf dev`: RequestKernel runs the pipeline, ResponseKernel handles errors. */
const bootApp = (): Hono => {
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

afterEach(() => {
  vi.restoreAllMocks();
});

const urlencoded = (body: string) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
});

const asJson = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Mounts a 0.5 ad-hoc route whose handler records the request it got, and returns the recorded value. */
const captureRoute = (method: "get" | "post", path: string, read: (req: LaratypeRequest) => unknown) => {
  const app = bootApp();
  const captured: { value?: unknown } = {};
  const route = {
    method,
    path,
    modelBinding: false,
    handler: (req: LaratypeRequest) => {
      captured.value = read(req);
      return { ok: true };
    },
  } satisfies AdHocRouteParams;
  app.on(method.toUpperCase(), path, RequestKernel.handle(route));
  return { app, captured };
};

const formWith = (entries: [string, string][]): RequestInit => {
  const form = new FormData();
  for (const [key, value] of entries) form.append(key, value);
  return { method: "POST", body: form };
};

const protoStates = () => ({
  x: ({} as Record<string, unknown>).x,
  y: ({} as Record<string, unknown>).y,
});

describe("a __proto__. segment in a form body (B30 #410)", () => {
  const bodies: [string, () => RequestInit][] = [
    ["multipart", () => formWith([["name", "ada"], ["__proto__.x", "polluted"], ["a.__proto__.y", "polluted"], ["z", "1"]])],
    ["urlencoded", () => urlencoded("name=ada&__proto__.x=polluted&a.__proto__.y=polluted&z=1")],
  ];
  const topLevelBodies: [string, () => RequestInit][] = [
    ["multipart", () => formWith([["name", "ada"], ["__proto__", "polluted"]])],
    ["urlencoded", () => urlencoded("name=ada&__proto__=polluted")],
  ];

  it.each(bodies)("drops it from a %s body, as Hono 4.13.17's parseBody({ dot: true }) does", async (_label, init) => {
    const { app, captured } = captureRoute("post", "/form", (req) => req.input());
    const response = await app.request("/form", init());
    expect(response.status).toBe(200);

    const input = captured.value as Record<string, unknown>;
    // The nested `__proto__` object is gone: Hono's 4.13.17 guard drops any dot key with a `__proto__.` segment, and
    // the pipeline mirrors it, so the submitted value cannot be reached through a `__proto__` key at all
    expect(Object.hasOwn(input, "__proto__")).toBe(false);
    expect(Object.hasOwn(input, "a")).toBe(false);
    // The fields around it still arrive
    expect(input).toEqual({ name: "ada", z: "1" });
    // The merge built a plain object: no submitted value reached a prototype
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
    expect(protoStates()).toEqual({ x: undefined, y: undefined });
  });

  it.each(topLevelBodies)("keeps the top-level __proto__ field of a %s body as an own key, as Hono does", async (_label, init) => {
    const { app, captured } = captureRoute("post", "/form", (req) => req.input());
    const response = await app.request("/form", init());
    expect(response.status).toBe(200);

    const input = captured.value as Record<string, string>;
    // No dot segment: Hono assigns it to a null-prototype object, and the query/body merge copies it as an own data key
    expect(Object.hasOwn(input, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(input, "__proto__")).toMatchObject({
      value: "polluted",
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(Object.getOwnPropertyDescriptor(input, "__proto__")?.get).toBeUndefined();
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
    expect(protoStates().x).toBeUndefined();
  });

  it("keeps constructor.prototype.x as own nested keys, never a prototype", async () => {
    const { app, captured } = captureRoute("post", "/form", (req) => req.input());
    const response = await app.request("/form", urlencoded("constructor.prototype.y=polluted&z=1"));
    expect(response.status).toBe(200);

    const input = captured.value as Record<string, any>;
    expect(Object.hasOwn(input, "constructor")).toBe(true);
    expect(Object.getPrototypeOf(input.constructor)).toBeNull();
    expect(Object.getPrototypeOf(input.constructor.prototype)).toBeNull();
    expect(input.constructor.prototype.y).toBe("polluted");
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
    expect(protoStates()).toEqual({ x: undefined, y: undefined });
  });
});

describe("a __proto__ key in a JSON body (B30 #410)", () => {
  const body = { __proto__: { x: "polluted" }, constructor: { prototype: { y: "polluted" } }, z: 1 };
  // A JSON literal `{ __proto__: ... }` would set the literal's prototype; the body is built from JSON text, as the
  // client sends it, which makes `__proto__` an own data key
  const text = '{"__proto__":{"x":"polluted"},"constructor":{"prototype":{"y":"polluted"}},"z":1}';

  it("keeps it as an own data key on the request input and all(), not a prototype", async () => {
    const { app, captured } = captureRoute("post", "/json", (req) => ({ input: req.input(), all: req.all() }));
    const response = await app.request("/json", { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
    expect(response.status).toBe(200);

    for (const value of Object.values(captured.value as Record<string, Record<string, unknown>>)) {
      expect(Object.hasOwn(value, "__proto__")).toBe(true);
      expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.value).toEqual({ x: "polluted" });
      expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.get).toBeUndefined();
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
      expect(value.z).toBe(1);
      expect((value.constructor as any).prototype.y).toBe("polluted");
    }
    expect(protoStates()).toEqual({ x: undefined, y: undefined });
  });

  it("reaches the handler's input fields as data", async () => {
    const { app, captured } = captureRoute("post", "/json", (req) => req.input("__proto__"));
    const response = await app.request("/json", { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
    expect(response.status).toBe(200);
    expect(captured.value).toEqual({ x: "polluted" });
    expect(protoStates()).toEqual({ x: undefined, y: undefined });
  });

  it("is stripped from the validated body of a contract route, before the handler", async () => {
    const contract = defineContract()({
      store: endpoint.post("/").body(z.object({ z: z.number() })).response(z.unknown(), 201),
    });
    let seen: unknown;
    class Store extends Controller {
      store(ctx: Ctx<typeof contract.store>) {
        seen = ctx.body;
        return ctx.body;
      }
    }
    const app = bootApp();
    Route.api(defineApi({ store: { contract, path: "/store", scopes: [] } }), (r) => [r.contract(contract, Store)]).mount(app);

    const response = await app.request("/store", { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
    expect(response.status).toBe(201);
    expect(seen).toEqual({ z: 1 });
    expect(Object.hasOwn(seen as object, "__proto__")).toBe(false);
    // The response echoes the validated body: the submitted key is gone there too
    expect(await response.json()).toEqual({ z: 1 });
    expect(protoStates()).toEqual({ x: undefined, y: undefined });
  });
});

describe("toDotFields' __proto__. guard (B30 #410)", () => {
  it("drops the keys Hono 4.13.17 drops and keeps a top-level __proto__", () => {
    const form = new FormData();
    form.append("__proto__", "top");
    form.append("__proto__.x", "polluted");
    form.append("a.__proto__.y", "polluted");
    form.append("a__proto__.z", "kept");
    form.append("x.__proto__", "tail");

    const fields = toDotFields(form);
    // The guard is Hono's regex, `/(?:^|\.)__proto__\./`: a `__proto__` segment at the start or after a dot is refused,
    // while `a__proto__` is a plain name and a trailing `__proto__` (no segment after it) is an own key of a null-
    // prototype group
    expect(Object.hasOwn(fields, "__proto__")).toBe(true);
    expect(fields.__proto__).toBe("top");
    expect(Object.hasOwn(fields, "a")).toBe(false);
    expect(fields.a__proto__).toEqual({ z: "kept" });
    expect(Object.getPrototypeOf(fields.x)).toBeNull();
    expect(Object.hasOwn(fields.x as object, "__proto__")).toBe(true);
    expect((fields.x as Record<string, unknown>).__proto__).toBe("tail");
    expect(Object.getPrototypeOf(fields)).toBeNull();
    expect(protoStates()).toEqual({ x: undefined, y: undefined });
  });

  it("refuses only the exact ASCII segment: case and unicode lookalikes stay data", () => {
    const form = new FormData();
    form.append("__PROTO__.x", "1");
    // A control character after the name is part of the key, not a separator: the key is a plain nested group
    form.append("__proto__\u0000.y", "2");
    form.append("__proto__\u{1F600}.z", "3");

    const fields = toDotFields(form);
    expect(fields.__PROTO__).toEqual({ x: "1" });
    expect((fields as Record<string, any>)["__proto__\u0000"]).toEqual({ y: "2" });
    expect((fields as Record<string, any>)["__proto__\u{1F600}"]).toEqual({ z: "3" });
    expect(protoStates()).toEqual({ x: undefined, y: undefined });
  });
});
