// A2 #120: authentication from the contract, with a typed ctx.user. The auth guard is enforced by Route.api.
import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Container, depsRegistry, Facade } from "@laratype/core";
import { HTTP_APP, ModelBindingRegistry } from "@laratype/support";
import { Model } from "@laratype/database";
import { defineApi, defineContract, defineScope, endpoint } from "@laratype/contract";
import { Controller, RequestKernel, ResponseKernel, Route, defineMiddleware, response } from "@laratype/http";
import type { ApiRouteBuilder } from "@laratype/http";
import { Auth, AuthManager, auth } from "../src";

// The contract's guard registry: the auth package links it, so 'admin' and 'api' are valid guard names.
declare module "@laratype/contract" {
  interface GuardRegistry {
    web: true;
    api: true;
    admin: true;
  }
}

class User {
  constructor(
    readonly id: number,
    readonly email: string,
  ) {}
}
class Admin extends User {
  constructor(
    id: number,
    email: string,
    readonly role: string,
  ) {
    super(id, email);
  }
}

const anything = { "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) } } as const;
const requiresName = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value: unknown) =>
      typeof (value as { name?: unknown } | null)?.name === "string"
        ? { value }
        : { issues: [{ message: "Required", path: ["name"] }] },
  },
} as const;

const user = new User(1, "ada@example.test");
const admin = new Admin(2, "grace@example.test", "admin");

/** The guard calls of the current test, and the app's guards as the container binds them. */
const calls: string[] = [];
const registered: Record<string, User | false> = {};
const manager = {
  defaultGuard: "web",
  guard(name: string = "web") {
    calls.push(name);
    return {
      name,
      user: async () => registered[name] ?? false,
      issueToken: async () => `token:${name}`,
    };
  },
};

const contract = defineContract()(
  {
    me: endpoint.get("/me").auth().response(anything),
    admin: endpoint.get("/admin").auth("admin").response(anything),
    open: endpoint.get("/open").public().response(anything),
    store: endpoint.post("/store").auth().body(requiresName).response(anything),
  },
  { auth: true },
);
const api = defineApi({ users: { contract, path: "/api/users", scopes: [] } });

/** The lookups of the bound model of `boundContract`: the guard must answer before any of them runs. */
const boundLookups: string[] = [];
class BoundUser {
  static readonly primaryKey = "id";
  static async findByRouteKey(key: string): Promise<BoundUser | null> {
    boundLookups.push(key);
    return key === "missing" ? null : new BoundUser(key);
  }
  constructor(readonly id: string) {}
}

/** A guarded contract with a path param, to pair A2's guard with H7's `r.bind()` (the order and the `user` key). */
const boundContract = defineContract()({ show: endpoint.get("/:user").auth().response(anything) });
const boundApi = defineApi({ bound: { contract: boundContract, path: "/api/bound", scopes: [] } });

class BoundController extends Controller {
  show(ctx: { user: User; params: { user: BoundUser } }) {
    return { current: ctx.user.email, param: ctx.params.user.id };
  }
}

const appOf = (routes: (r: ApiRouteBuilder<typeof api>) => unknown, mount?: (app: Hono) => void) => {
  const container = new Container({ deps: depsRegistry });
  const app = new Hono();
  container.instance(HTTP_APP, app);
  container.instance(AuthManager, manager as unknown as AuthManager);
  new RequestKernel(container).boot();
  new ResponseKernel(container).boot();
  Route.api(api, routes as never).mount(app);
  mount?.(app);
  return app;
};

const boundApp = () => {
  const container = new Container({ deps: depsRegistry });
  const app = new Hono();
  container.instance(HTTP_APP, app);
  container.instance(AuthManager, manager as unknown as AuthManager);
  new RequestKernel(container).boot();
  new ResponseKernel(container).boot();
  Route.api(boundApi, (r) => [r.bind({ user: BoundUser }).contract(boundContract, BoundController)]).mount(app);
  return app;
};

class UserController extends Controller {
  me(ctx: { user: User }) {
    const authenticated = Auth.user();
    return { user: ctx.user, current: authenticated?.getUser() ?? null };
  }
  async admin(ctx: { user: Admin }) {
    const authenticated = Auth.user();
    if (!authenticated) throw new Error("the auth middleware did not set a user");
    // Auth.login() binds the authenticating guard too (A6 #335)
    const relogged = Auth.login(ctx.user);
    return { user: ctx.user, token: await relogged.generateToken({ name: "t", abilities: "*" }) };
  }
  open(ctx: { user?: User }) {
    return { user: ctx.user ?? null };
  }
  store() {
    return { stored: true };
  }
}

const app = () => appOf((r) => [r.contract(contract, UserController)]);

const get = (path: string) => app().request(path);
const post = (path: string, body?: unknown) =>
  app().request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  calls.length = 0;
  boundLookups.length = 0;
  registered.web = false;
  registered.api = false;
  registered.admin = false;
});

afterEach(() => {
  vi.restoreAllMocks();
  Facade.setFacadeApplication(undefined);
  delete (globalThis as { __laratype_config?: unknown }).__laratype_config;
});

describe("authentication from the contract", () => {
  it("answers the derived 401 without a user", async () => {
    const res = await get("/api/users/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthenticated." });
    // The guard of the contract's auth: true is the default guard
    expect(calls).toEqual(["web"]);
  });

  it("runs the route with the user in ctx and in Auth.user()", async () => {
    registered.web = user;
    const body = await (await get("/api/users/me")).json();
    expect(body.user).toEqual({ id: 1, email: "ada@example.test" });
    expect(body.current).toEqual({ id: 1, email: "ada@example.test" });
  });

  it("a named guard's user types and resolves ctx.user, and Auth.login() signs for it", async () => {
    registered.admin = admin;
    const body = await (await get("/api/users/admin")).json();
    expect(body.user).toEqual({ id: 2, email: "grace@example.test", role: "admin" });
    // A6 #335: Auth.user() and Auth.login() bind the guard that authenticated the request, not the default one
    expect(body.token).toBe("token:admin");
    // The guard resolves the request, then Auth.user() and Auth.login() resolve the same guard for their wrappers
    expect(calls).toEqual(["admin", "admin", "admin"]);
  });

  it(".public() opts out: no guard runs and no user is resolved", async () => {
    const body = await (await get("/api/users/open")).json();
    expect(body).toEqual({ user: null });
    expect(calls).toEqual([]);
  });

  it("the nearest auth level wins: an endpoint guard over the contract default", async () => {
    registered.admin = admin;
    registered.web = user;
    await get("/api/users/admin");
    // The admin handler also reads Auth.user() and Auth.login(), which each resolve the authenticating guard
    expect(calls).toEqual(["admin", "admin", "admin"]);
  });

  it("the 401 comes before input validation (422)", async () => {
    const unauthorized = await post("/api/users/store");
    expect(unauthorized.status).toBe(401);
    registered.web = user;
    const invalid = await post("/api/users/store", {});
    expect(invalid.status).toBe(422);
    expect(await (await post("/api/users/store", { name: "Ada" })).json()).toEqual({ stored: true });
  });

  it("the 401 comes before route middleware", async () => {
    const ran: string[] = [];
    const audit = defineMiddleware(function audit(_request, next) {
      ran.push("route");
      return next();
    });
    const audited = appOf((r) => [r.middleware(audit).contract(contract, UserController)]);
    const res = await audited.request("/api/users/me");
    expect(res.status).toBe(401);
    expect(ran).toEqual([]);
    registered.web = user;
    expect((await audited.request("/api/users/me")).status).toBe(200);
    expect(ran).toEqual(["route"]);
  });

  it("a scope guard applies to every endpoint under it", async () => {
    registered.api = user;
    const scoped = defineContract()({ index: endpoint.get("/").response(anything) });
    const scope = defineScope()({ auth: "api" });
    const scopedApi = defineApi({ scoped: { contract: scoped, path: "/scoped", scopes: [{ scope, dir: "" }] } });
    class ScopedController extends Controller {
      index(ctx: { user: User }) {
        return { user: ctx.user };
      }
    }
    const container = new Container({ deps: depsRegistry });
    const hono = new Hono();
    container.instance(HTTP_APP, hono);
    container.instance(AuthManager, manager as unknown as AuthManager);
    new RequestKernel(container).boot();
    new ResponseKernel(container).boot();
    Route.api(scopedApi, (r) => [r.contract(scoped, ScopedController)]).mount(hono);
    expect(await (await hono.request("/scoped")).json()).toEqual({ user: { id: 1, email: "ada@example.test" } });
    expect(calls).toEqual(["api"]);
  });

  it("auth() works on an ad-hoc route and in a manual RequestKernel.handle", async () => {
    registered.admin = admin;
    const adHoc = appOf(
      (r) => [
        r.contract(contract, UserController),
        r
          .middleware(auth("admin"))
          .get("/adhoc", (request) => ({ user: (request as unknown as { user: Admin }).user })),
      ],
      (hono) => {
        hono.get(
          "/manual",
          RequestKernel.handle({
            method: "get",
            path: "/manual",
            middleware: [auth("admin")],
            handler: (request) => ({ user: (request as unknown as { user: Admin }).user }),
          }),
        );
      },
    );
    expect(await (await adHoc.request("/adhoc")).json()).toEqual({
      user: { id: 2, email: "grace@example.test", role: "admin" },
    });
    expect(await (await adHoc.request("/manual")).json()).toEqual({
      user: { id: 2, email: "grace@example.test", role: "admin" },
    });
    expect(calls).toEqual(["admin", "admin"]);
  });

  it("reads the bearer token with the real TokenGuard: 401 without one, 200 with one", async () => {
    class TokenUser extends Model {
      declare id: number;
      declare email: string;
      static getRepository() {
        return { metadata: { primaryColumns: [{ propertyName: "id" }] } };
      }
      static async findOneBy(fields: { id?: number }) {
        return fields.id === 7 ? Object.assign(new TokenUser(), { id: 7, email: "token@example.test" }) : null;
      }
    }
    const globals = globalThis as { __laratype_config?: unknown };
    globals.__laratype_config = { key: "a2-contract-auth-test" };
    const container = new Container({ deps: depsRegistry });
    const registry = new ModelBindingRegistry();
    registry.models = { TokenUser };
    container.instance(ModelBindingRegistry, registry);
    Facade.setFacadeApplication(container);
    const real = new AuthManager({
      default: { guard: "web" },
      guards: { web: { provider: TokenUser, verification: "jwt" } },
    } as never);
    const token = await real
      .guard<{ id: number; email: string }>("web")
      .issueToken(Object.assign(new TokenUser(), { id: 7, email: "token@example.test" }), {
        name: "t",
        abilities: "*",
      });

    const hono = new Hono();
    container.instance(HTTP_APP, hono);
    container.instance(AuthManager, real);
    new RequestKernel(container).boot();
    new ResponseKernel(container).boot();
    Route.api(api, (r) => [r.contract(contract, UserController)]).mount(hono);

    expect((await hono.request("/api/users/me")).status).toBe(401);
    const res = await hono.request("/api/users/me", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).user).toEqual({ id: 7, email: "token@example.test" });
  });
});

describe("Route.api order", () => {
  it("a short-circuiting typed middleware cannot skip the guard", async () => {
    const deny = defineMiddleware(function deny() {
      return response({ denied: true }, 403);
    });
    const denied = appOf((r) => [r.middleware(deny).contract(contract, UserController)]);
    const res = await denied.request("/api/users/me");
    expect(res.status).toBe(401);
    registered.web = user;
    expect((await denied.request("/api/users/me")).status).toBe(403);
  });

  it("the 401 comes before a 404 from a binding miss, and the model lookup does not run", async () => {
    const app = boundApp();
    const unauthorized = await app.request("/api/bound/missing");
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthenticated." });
    // The binding step runs after the guard: an unauthenticated request must not learn whether the row exists
    expect(boundLookups).toEqual([]);

    registered.web = user;
    const missing = await app.request("/api/bound/missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ code: "NOT_FOUND", message: "Not Found." });
    expect(boundLookups).toEqual(["missing"]);

    const found = await app.request("/api/bound/7");
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ current: "ada@example.test", param: "7" });
    expect(boundLookups).toEqual(["missing", "7"]);
  });

  it("a bind key named `user` lands in ctx.params, next to the guard's ctx.user", async () => {
    registered.web = user;
    const res = await boundApp().request("/api/bound/7");
    expect(res.status).toBe(200);
    // Both are provided and distinct: the guard's user is the ctx key, the bound model is the params key
    expect(await res.json()).toEqual({ current: "ada@example.test", param: "7" });
    expect(boundLookups).toEqual(["7"]);
  });

  it("refuses a `__proto__` bind key on an auth route: H7's refusal runs before the guard", () => {
    expect(() =>
      Route.api(boundApi, (r) => {
        // The untyped builder, as H7's own refusal tests: the key is refused at runtime, before any proof
        const bound = r.bind({ ["__proto__"]: BoundUser } as never) as unknown as typeof r;
        return [bound.contract(boundContract, BoundController)];
      }),
    ).toThrow(
      "[@laratype/http] Route.api: r.bind(): `__proto__` cannot be a binding key: every object reads it as its prototype, so the binding would be dropped. " +
        "Fix: name the path param something else.",
    );
  });
});

describe("the contract auth registration", () => {
  it("does not throw when contractAuth.ts is evaluated twice (a reload, or a second copy of the package)", async () => {
    const slot = Symbol.for("laratype.http.contractAuth");
    const first = (globalThis as Record<symbol, unknown>)[slot];
    expect(typeof first).toBe("function");
    vi.resetModules();
    await expect(import("../src/contractAuth")).resolves.toBeDefined();
    const second = (globalThis as Record<symbol, unknown>)[slot];
    expect(typeof second).toBe("function");
    // The second evaluation registered its own closure, and the slot took it: last wins
    expect(second).not.toBe(first);
  });
});
