// A2 #120: the contract auth slot of @laratype/http. @laratype/auth fills it on import; without it mount() fails
// closed. The slot itself is tested with stand-in factories: no import of @laratype/auth here.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { defineApi, defineContract, endpoint } from "@laratype/contract";
import type { AnyContract } from "@laratype/contract";
import { Controller, Route, contractAuth, defineMiddleware, registerContractAuth } from "../../src/index";
import type { ApiRoutes, ContractAuthFactory } from "../../src/index";

const anything = { "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) } } as const;
const slot = Symbol.for("laratype.http.contractAuth");
const brand = Symbol.for("laratype.auth.contractAuthFactory");
const branded = (factory: ContractAuthFactory): ContractAuthFactory =>
  Object.defineProperty(factory, brand, { value: true });

const apiOf = (contract: AnyContract, name = "users") =>
  defineApi({ [name]: { contract, path: `/${name}`, scopes: [] } });

class UserController extends Controller {
  index() {
    return { ok: true };
  }
}

const mount = (routes: ApiRoutes) => routes.mount(new Hono());

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[slot];
});

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[slot];
});

describe("the contract auth slot", () => {
  it("fails mount() closed when a route declares auth and no factory is registered", () => {
    const guarded = defineContract()({ index: endpoint.get("/").response(anything) }, { auth: true });
    const routes = Route.api(apiOf(guarded), (r) => [r.contract(guarded, UserController)]);
    expect(() => mount(routes)).toThrow(
      "[@laratype/http] Route.api: users.index: the contract declares auth, but @laratype/auth is not imported.",
    );
  });

  it('treats a slot value that is not a function as "not imported"', () => {
    (globalThis as Record<symbol, unknown>)[slot] = 42;
    expect(contractAuth()).toBeUndefined();
    const guarded = defineContract()({ index: endpoint.get("/").response(anything) }, { auth: true });
    const routes = Route.api(apiOf(guarded), (r) => [r.contract(guarded, UserController)]);
    expect(() => mount(routes)).toThrow("the contract declares auth, but @laratype/auth is not imported.");
  });

  it("accepts the same factory twice and refuses a different one", () => {
    const factory: ContractAuthFactory = () => defineMiddleware((_request, next) => next());
    registerContractAuth(factory);
    expect(contractAuth()).toBe(factory);
    expect(() => registerContractAuth(factory)).not.toThrow();
    expect(() => registerContractAuth(() => defineMiddleware((_request, next) => next()))).toThrow(
      /registerContractAuth\(\): the contract auth factory is already registered/,
    );
  });

  it("lets a branded factory replace another branded one: last wins, and the second one is used", () => {
    let firstCalls = 0;
    let secondCalls = 0;
    const first: ContractAuthFactory = () => {
      firstCalls++;
      return defineMiddleware((_request, next) => next());
    };
    const second: ContractAuthFactory = () => {
      secondCalls++;
      return defineMiddleware((_request, next) => next());
    };
    registerContractAuth(branded(first));
    expect(() => registerContractAuth(branded(second))).not.toThrow();
    expect(contractAuth()).toBe(second);
    // mount() is what calls the factory for a guarded route: the slot now holds the second one
    const guarded = defineContract()({ index: endpoint.get("/").response(anything) }, { auth: true });
    mount(Route.api(apiOf(guarded), (r) => [r.contract(guarded, UserController)]));
    expect([firstCalls, secondCalls]).toEqual([0, 1]);
  });

  it("refuses a branded factory over a non-branded function", () => {
    const plain: ContractAuthFactory = () => defineMiddleware((_request, next) => next());
    registerContractAuth(plain);
    expect(() => registerContractAuth(branded(() => defineMiddleware((_request, next) => next())))).toThrow(
      /registerContractAuth\(\): the contract auth factory is already registered \(plain\)/,
    );
    expect(contractAuth()).toBe(plain);
  });

  it("refuses a non-branded function over a branded factory", () => {
    const marked: ContractAuthFactory = () => defineMiddleware((_request, next) => next());
    branded(marked);
    registerContractAuth(marked);
    expect(() => registerContractAuth(() => defineMiddleware((_request, next) => next()))).toThrow(
      /registerContractAuth\(\): the contract auth factory is already registered \(marked\)/,
    );
    expect(contractAuth()).toBe(marked);
  });

  it("replaces a slot value that is not a function: it is not a registered factory", () => {
    (globalThis as Record<symbol, unknown>)[slot] = 42;
    const factory: ContractAuthFactory = () => defineMiddleware((_request, next) => next());
    expect(() => registerContractAuth(factory)).not.toThrow();
    expect(contractAuth()).toBe(factory);
  });

  it("prepends the factory middleware before the app-declared route middleware, and leaves the entry untouched", async () => {
    const calls: string[] = [];
    const guards: unknown[] = [];
    registerContractAuth((guard) => {
      guards.push(guard);
      return defineMiddleware<{ user: { id: number } }>(function guardMiddleware(_request, next) {
        calls.push("guard");
        return next({ user: { id: 1 } });
      });
    });
    const audit = defineMiddleware(function audit(_request, next) {
      calls.push("route");
      return next();
    });
    const guarded = defineContract()({ index: endpoint.get("/").response(anything) }, { auth: "api" });
    const routes = Route.api(apiOf(guarded), (r) => [r.middleware(audit).contract(guarded, UserController)]);
    // RouteEntry.middleware stays what the app declared (the guard is not listed)
    expect(routes.routes[0]!.middleware).toEqual([audit]);
    const app = new Hono();
    routes.mount(app);
    expect(await (await app.request("/users")).json()).toEqual({ ok: true });
    expect(guards).toEqual(["api"]);
    expect(calls).toEqual(["guard", "route"]);
  });

  it("does not call the factory for a public route", async () => {
    let called = 0;
    registerContractAuth(() => {
      called++;
      return defineMiddleware((_request, next) => next());
    });
    const open = defineContract()({ index: endpoint.get("/").public().response(anything) }, { auth: true });
    mount(Route.api(apiOf(open), (r) => [r.contract(open, UserController)]));
    expect(called).toBe(0);
  });
});
