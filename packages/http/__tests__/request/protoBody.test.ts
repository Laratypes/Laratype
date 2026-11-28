// B30 #410: a request body's `__proto__`, `constructor` and `prototype` keys are data, never a prototype. The pipeline
// builds every form group with `Object.create(null)` and mirrors Hono 4.13.23's `__proto__.` / `constructor.prototype.`
// guard; a JSON body keeps `JSON.parse`'s own data key. Each case checks that a value submitted under such a key reaches
// no prototype.
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

  it.each(bodies)("drops it from a %s body, as Hono 4.13.23's parseBody({ dot: true }) does", async (_label, init) => {
    const { app, captured } = captureRoute("post", "/form", (req) => req.input());
    const response = await app.request("/form", init());
    expect(response.status).toBe(200);

    const input = captured.value as Record<string, unknown>;
    // The nested `__proto__` object is gone: Hono's 4.13.23 guard drops a key in which `__proto__` is a segment followed
    // by another segment, and
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

  it("drops constructor.prototype.x from a form body, while a JSON body keeps it as data", async () => {
    // Hono 4.13.23's guard `/(?:^|\.)(?:__proto__|constructor\.prototype)\./` refuses the nested key; toDotFields mirrors
    // it, so the submitted object is gone before the input is built
    const form = captureRoute("post", "/form", (req) => req.input());
    const formResponse = await form.app.request("/form", urlencoded("constructor.prototype.x=1&z=2"));
    expect(formResponse.status).toBe(200);

    const formInput = form.captured.value as Record<string, unknown>;
    expect(Object.hasOwn(formInput, "constructor")).toBe(false);
    expect(formInput).toEqual({ z: "2" });
    expect(Object.getPrototypeOf(formInput)).toBe(Object.prototype);
    expect(protoStates()).toEqual({ x: undefined, y: undefined });

    // A JSON body is unchanged: JSON.parse makes the key an own data key, and the form guard never runs on it
    const json = captureRoute("post", "/json", (req) => req.input());
    const jsonResponse = await json.app.request("/json", asJson({ constructor: { prototype: { x: 1 } }, z: 2 }));
    expect(jsonResponse.status).toBe(200);

    const jsonInput = json.captured.value as Record<string, any>;
    expect(Object.hasOwn(jsonInput, "constructor")).toBe(true);
    expect(jsonInput.constructor.prototype.x).toBe(1);
    expect(jsonInput.z).toBe(2);
    expect(Object.getPrototypeOf(jsonInput)).toBe(Object.prototype);
  });
});

describe("a __proto__ query parameter (B30 #410)", () => {
  it("stays an own data key in the query, input and all() of a 0.5 route", async () => {
    const { app, captured } = captureRoute("get", "/q", (req) => ({ query: req.query(), input: req.input(), all: req.all() }));
    const response = await app.request("/q?__proto__=polluted&a=1");
    expect(response.status).toBe(200);

    const values = captured.value as Record<string, Record<string, unknown>>;
    // Hono 4.13.17 keeps the key on a null-prototype map (4.9.6 dropped it), and `Object.fromEntries`/spreads copy it
    // as an own data key of the plain objects the facade returns
    for (const value of Object.values(values)) {
      expect(Object.hasOwn(value, "__proto__")).toBe(true);
      expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.value).toBe("polluted");
      expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.get).toBeUndefined();
      expect(value.a).toBe("1");
    }
    expect(Object.getPrototypeOf(values.input)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(values.all)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(values.query)).toBeNull();
    expect(protoStates()).toEqual({ x: undefined, y: undefined });
  });

  it("is stripped from the validated query of a contract route, before the handler", async () => {
    const contract = defineContract()({
      index: endpoint.get("/").query(z.object({ a: z.string() })).response(z.unknown()),
    });
    let seen: unknown;
    class Index extends Controller {
      index(ctx: Ctx<typeof contract.index>) {
        seen = ctx.query;
        return ctx.query;
      }
    }
    const app = bootApp();
    Route.api(defineApi({ index: { contract, path: "/q", scopes: [] } }), (r) => [r.contract(contract, Index)]).mount(app);

    const response = await app.request("/q?__proto__=polluted&a=1");
    expect(response.status).toBe(200);
    expect(seen).toEqual({ a: "1" });
    expect(Object.hasOwn(seen as object, "__proto__")).toBe(false);
    expect(await response.json()).toEqual({ a: "1" });
    expect(protoStates()).toEqual({ x: undefined, y: undefined });
  });
});

describe("a __proto__ key in a JSON body (B30 #410)", () => {
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

  it("picks and omits an own __proto__ key as data, never as the result's prototype", async () => {
    const { app, captured } = captureRoute("post", "/json", (req) => ({
      picked: req.input(["__proto__", "z"]),
      only: req.only(["__proto__", "z"]),
      except: req.except(["nope"]),
      exceptProto: req.except(["__proto__"]),
      field: req.input("__proto__"),
      has: req.has("__proto__"),
    }));
    const response = await app.request("/json", { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
    expect(response.status).toBe(200);

    const capturedValue = captured.value as Record<string, any>;
    // es-toolkit's compat `pick` assigns each own key: without the accessor's fix, an own `__proto__` swapped the
    // picked object's prototype, so `picked.x` answered the submitted value and the key itself was gone
    for (const picked of [capturedValue.picked, capturedValue.only, capturedValue.except]) {
      expect(Object.getPrototypeOf(picked)).toBe(Object.prototype);
      expect(Object.hasOwn(picked, "__proto__")).toBe(true);
      expect(Object.getOwnPropertyDescriptor(picked, "__proto__")?.value).toEqual({ x: "polluted" });
      expect(picked).toMatchObject({ z: 1 });
    }
    expect(capturedValue.except).not.toHaveProperty("nope");
    // `omit` clones with define semantics and `unset` drops the own key: no prototype is reachable through it either
    expect(Object.getPrototypeOf(capturedValue.exceptProto)).toBe(Object.prototype);
    expect(Object.hasOwn(capturedValue.exceptProto, "__proto__")).toBe(false);
    expect(capturedValue.exceptProto).toMatchObject({ z: 1 });
    expect((capturedValue.exceptProto.constructor as any).prototype.y).toBe("polluted");
    expect(capturedValue.field).toEqual({ x: "polluted" });
    expect(capturedValue.has).toBe(true);
    expect(protoStates()).toEqual({ x: undefined, y: undefined });
  });

  it("treats a non-array only() key as no keys, without walking an array-like", async () => {
    // `only()` is typed `string[]`; a JS caller can still pass another value. `pick` would walk a `{ length: 1e9 }`
    // object, and `.includes` would throw on a number, so the accessor refuses the shape before either
    const { app, captured } = captureRoute("post", "/json", (req) => ({
      object: req.only({ length: 1e9 } as never),
      number: req.only(42 as never),
      nan: req.only(Number.NaN as never),
      missing: req.input(42 as never),
      infinite: req.input(Number.POSITIVE_INFINITY as never),
      arrayLike: req.input({ length: 1e9 } as never),
      long: req.only(["x".repeat(100_000)]),
      unicode: req.only(["__proto__\u0000", "\u{1F600}", "\uD800"]),
    }));
    const response = await app.request("/json", { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
    expect(response.status).toBe(200);
    expect(captured.value).toEqual({
      object: {},
      number: {},
      nan: {},
      missing: undefined,
      infinite: undefined,
      arrayLike: undefined,
      long: {},
      unicode: {},
    });
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

describe("Hono 4.13.23's form nesting limits (B30 #410)", () => {
  const dotKey = (segments: number) => Array.from({ length: segments }, (_, index) => `k${index}`).join(".");

  it("accepts 33 dot segments and refuses 34", () => {
    // Hono's `key.split(".", 34)` and `keys.length > 33` in `handleParsingNestedValues`
    const at = new FormData();
    at.append(dotKey(33), "x");
    expect(() => toDotFields(at)).not.toThrow();

    const over = new FormData();
    over.append(dotKey(34), "x");
    expect(() => toDotFields(over)).toThrow("Nesting limit exceeded");
  });

  it("accepts 10,000 created groups and refuses 10,001", () => {
    // Hono's `state.count++ >= MAX_NESTED_OBJECTS` (10,000) in `handleParsingNestedValues`
    const at = new FormData();
    for (let index = 0; index < 10_000; index++) at.append(`g${index}.x`, "1");
    expect(() => toDotFields(at)).not.toThrow();

    const over = new FormData();
    for (let index = 0; index <= 10_000; index++) over.append(`g${index}.x`, "1");
    expect(() => toDotFields(over)).toThrow("Nesting limit exceeded");
  });
});

describe("toDotFields' __proto__. / constructor.prototype. guard (B30 #410)", () => {
  it("drops the keys Hono 4.13.23 drops and keeps the rest", () => {
    const form = new FormData();
    form.append("__proto__", "top");
    form.append("__proto__.x", "polluted");
    form.append("a.__proto__.y", "polluted");
    form.append("a__proto__.z", "kept");
    form.append("x.__proto__", "tail");
    form.append("constructor.prototype.x", "polluted");
    form.append("constructor.y", "kept");

    const fields = toDotFields(form);
    // The guard is Hono's 4.13.23 regex, `/(?:^|\.)(?:__proto__|constructor\.prototype)\./`: a `__proto__` or
    // `constructor.prototype` segment at the start or after a dot **and followed by another segment** is refused, while
    // `a__proto__` is a plain name, a trailing `__proto__` (no segment after it) is an own key, and `constructor.y`
    // names no prototype
    expect(Object.hasOwn(fields, "__proto__")).toBe(true);
    expect(fields.__proto__).toBe("top");
    expect(Object.hasOwn(fields, "a")).toBe(false);
    expect(fields.a__proto__).toEqual({ z: "kept" });
    expect(Object.getPrototypeOf(fields.x)).toBeNull();
    expect(Object.hasOwn(fields.x as object, "__proto__")).toBe(true);
    expect((fields.x as Record<string, unknown>).__proto__).toBe("tail");
    expect(Object.getPrototypeOf(fields.constructor)).toBeNull();
    expect(fields.constructor).toEqual({ y: "kept" });
    expect(Object.hasOwn(fields.constructor as object, "prototype")).toBe(false);
    expect(Object.getPrototypeOf(fields)).toBeNull();
    expect(protoStates()).toEqual({ x: undefined, y: undefined });
  });

  it("refuses only the exact ASCII segment: case and unicode lookalikes stay data", () => {
    const form = new FormData();
    form.append("__PROTO__.x", "1");
    form.append("Constructor.Prototype.y", "4");
    // A control character after the name is part of the key, not a separator: the key is a plain nested group
    form.append("__proto__\u0000.y", "2");
    form.append("__proto__\u{1F600}.z", "3");

    const fields = toDotFields(form);
    expect(fields.__PROTO__).toEqual({ x: "1" });
    expect(fields.Constructor).toEqual({ Prototype: { y: "4" } });
    expect((fields as Record<string, any>)["__proto__\u0000"]).toEqual({ y: "2" });
    expect((fields as Record<string, any>)["__proto__\u{1F600}"]).toEqual({ z: "3" });
    expect(protoStates()).toEqual({ x: undefined, y: undefined });
  });
});
