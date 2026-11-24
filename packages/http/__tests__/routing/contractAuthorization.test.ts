// H8 #122: the route chain of the contract policies, with stand-in checks. The real policyCheck/policyAuthorize
// semantics and the 401 are tested in packages/auth (contractAuthorization.test.ts); here the route wiring is.
import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Container, depsRegistry } from "@laratype/core";
import { ContextApi, HTTP_APP } from "@laratype/support";
import { errors, defineApi, defineContract, defineScope, endpoint } from "@laratype/contract";
import type { ContractPrefix } from "@laratype/contract";
import { Controller, RequestKernel, ResponseKernel, Route, contractAuth, contractPolicies, defineMiddleware, registerContractAuth, registerContractPolicies } from "../../src/index";
import type { AnyTypedMiddleware, ApiRoutes, ContractPolicyChecks } from "../../src/index";

const anything = { "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) } } as const;
const requiresName = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value: unknown) =>
      typeof (value as { name?: unknown } | null)?.name === "string" ? { value } : { issues: [{ message: "Required", path: ["name"] }] },
  },
} as const;

const slot = Symbol.for("laratype.http.contractPolicies");
const currentUser = { id: 1, email: "ada@example.test" };
const authFactory = () => defineMiddleware<{ user?: unknown }>(async (_request, next) => {
  ContextApi.setUser(currentUser);
  return next({ user: currentUser });
});
if (!contractAuth()) registerContractAuth(authFactory);

const userLookups: string[] = [];
const postLookups: string[] = [];
class BoundUser {
  static readonly primaryKey = "id";
  static async findByRouteKey(key: string) {
    userLookups.push(key);
    return new BoundUser(key);
  }
  constructor(readonly id: string) {}
}
class BoundPost {
  static readonly primaryKey = "id";
  static async findByRouteKey(key: string) {
    postLookups.push(key);
    return key === "missing" ? null : new BoundPost(key);
  }
  constructor(readonly id: string) {}
}

class RootPolicy {
  before() { return null; }
}
class UserPolicy {
  before() { return null; }
}
class PostPolicy {
  before() { return null; }
  update(_user: unknown, _post: BoundPost) { return true; }
}
class OptionalPostPolicy {
  show(_user: unknown, _post?: BoundPost) { return true; }
}

const root = defineScope()({ auth: true, authorize: true });
const userScope = defineScope<ContractPrefix<"/api/users/:user", [typeof root]>>()({ authorize: true });
const posts = defineContract<ContractPrefix<"/api/users/:user/posts", [typeof root, typeof userScope]>>()({
  update: endpoint.patch("/:post").body(requiresName).response(anything),
  open: endpoint.get("/open").authorize(false).response(anything),
});
const comments = defineContract<ContractPrefix<"/api/users/:user/comments", [typeof root, typeof userScope]>>()({
  index: endpoint.get("/").response(anything),
});
const appApi = defineApi({
  "users.posts": { contract: posts, path: "/api/users/:user/posts", scopes: [{ scope: root, dir: "" }, { scope: userScope, dir: "users/[user]" }] },
  "users.comments": { contract: comments, path: "/api/users/:user/comments", scopes: [{ scope: root, dir: "" }, { scope: userScope, dir: "users/[user]" }] },
});

class PostController extends Controller {
  update() { return { updated: true }; }
  open() { return { open: true }; }
}
class CommentsController extends Controller {
  index() { return { comments: [] }; }
}

interface Call {
  readonly level: "check" | "authorize";
  readonly policy: object;
  readonly user: unknown;
  readonly ability: string;
  readonly args: unknown[];
}

const calls: Call[] = [];
let scopeAnswers: (boolean | null)[] = [];
let endpointResult: "allow" | "deny" | "throw" = "allow";

const checks: ContractPolicyChecks = {
  async check(policy, user, ability, ...args) {
    calls.push({ level: "check", policy, user, ability, args });
    return scopeAnswers.shift() ?? null;
  },
  async authorize(policy, user, ability, ...args) {
    calls.push({ level: "authorize", policy, user, ability, args });
    if (endpointResult === "deny") throw errors.forbidden();
    if (endpointResult === "throw") throw new Error("policy failed");
  },
};

const build = (middleware: AnyTypedMiddleware | undefined = undefined) => {
  const routes = Route.api(appApi, (r) => {
    const bound = r.bind({ user: BoundUser, post: BoundPost });
    return [
      r.bind({ user: BoundUser }).scope("", { policy: RootPolicy }),
      r.bind({ user: BoundUser }).scope("users/[user]", { policy: UserPolicy }),
      middleware === undefined
        ? bound.contract(posts, PostController, { policy: PostPolicy })
        : bound.middleware(middleware).contract(posts, PostController, { policy: PostPolicy }),
      r.bind({ user: BoundUser }).contract(comments, CommentsController),
    ];
  });
  const container = new Container({ deps: depsRegistry });
  const app = new Hono();
  container.instance(HTTP_APP, app);
  new RequestKernel(container).boot();
  new ResponseKernel(container).boot();
  routes.mount(app);
  return app;
};

const update = (app: Hono, body: unknown = { name: "Ada" }, post = "9") =>
  app.request(`/api/users/7/posts/${post}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  delete (globalThis as Record<symbol, unknown>)[slot];
  registerContractPolicies(checks);
  calls.length = 0;
  scopeAnswers = [];
  endpointResult = "allow";
  userLookups.length = 0;
  postLookups.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<symbol, unknown>)[slot];
});

describe("the contract policy chain", () => {
  it("runs the scopes outer to inner, then the endpoint policy, once each, with the resolved models", async () => {
    scopeAnswers = [null, null];
    const response = await update(build());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: true });

    // Scope policies: the whole bound-model record; endpoint policy: the endpoint's own bound models, in path order
    expect(calls.map((call) => [call.level, (call.policy as object).constructor.name, call.ability])).toEqual([
      ["check", "RootPolicy", "update"],
      ["check", "UserPolicy", "update"],
      ["authorize", "PostPolicy", "update"],
    ]);
    expect(calls[0]!.args).toEqual([{ user: expect.any(BoundUser), post: expect.any(BoundPost) }]);
    expect(calls[1]!.args).toEqual(calls[0]!.args);
    const bound = calls[0]!.args[0] as { user: BoundUser; post: BoundPost };
    expect(calls[2]!.args).toEqual([bound.post]);
    // The user is the guard's, never the ctx extension
    expect(calls.map((call) => call.user)).toEqual([currentUser, currentUser, currentUser]);
    // H7 resolved each model once, and the same instances reach both levels
    expect(userLookups).toEqual(["7"]);
    expect(postLookups).toEqual(["9"]);
  });

  it("a scope denial is the derived 403: no inner scope, no endpoint policy, no handler", async () => {
    scopeAnswers = [null, false];
    const response = await update(build());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "This action is unauthorized." });
    expect(calls.map((call) => (call.policy as object).constructor.name)).toEqual(["RootPolicy", "UserPolicy"]);
  });

  it("a scope before that allows skips the inner scopes and the endpoint policy", async () => {
    scopeAnswers = [true];
    const response = await update(build());
    expect(response.status).toBe(200);
    expect(calls.map((call) => (call.policy as object).constructor.name)).toEqual(["RootPolicy"]);
    expect(userLookups).toEqual(["7"]);
  });

  it("an endpoint policy denial is the derived 403", async () => {
    scopeAnswers = [null, null];
    endpointResult = "deny";
    const response = await update(build());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "This action is unauthorized." });
    expect(calls.at(-1)!.level).toBe("authorize");
  });

  it("a policy throw is a 500, never a denial", async () => {
    scopeAnswers = [null, null];
    endpointResult = "throw";
    const response = await update(build());
    expect(response.status).toBe(500);
  });

  it("an all-null chain with no endpoint policy denies closed", async () => {
    scopeAnswers = [null, null];
    const response = await build().request("/api/users/7/comments");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "This action is unauthorized." });
    expect(calls.every((call) => call.level === "check")).toBe(true);
  });

  it("runs before the 422: an invalid body is a 403 when the policy denies", async () => {
    scopeAnswers = [null, null];
    expect((await update(build(), {})).status).toBe(422);
    calls.length = 0;
    scopeAnswers = [false];
    const denied = await update(build(), {});
    expect(denied.status).toBe(403);
    expect(calls.map((call) => (call.policy as object).constructor.name)).toEqual(["RootPolicy"]);
  });

  it("a route middleware that replaces ctx.user cannot change the user the policies see", async () => {
    const replace = defineMiddleware<{ user: { id: number } }>(async (_request, next) => next({ user: { id: 999 } }));
    scopeAnswers = [null, null];
    const response = await update(build(replace));
    expect(response.status).toBe(200);
    expect(calls.map((call) => call.user)).toEqual([currentUser, currentUser, currentUser]);
  });

  it("does nothing for .authorize(false), a public route or an ad-hoc route", async () => {
    const app = build();
    expect((await app.request("/api/users/7/posts/open")).status).toBe(200);
    const adHoc = Route.api(appApi, (r) => [
      r.bind({ user: BoundUser }).scope("", { policy: RootPolicy }),
      r.bind({ user: BoundUser }).scope("users/[user]", { policy: UserPolicy }),
      (r.bind({ user: BoundUser, post: BoundPost }).contract(posts, PostController, { policy: PostPolicy })),
      r.bind({ user: BoundUser }).contract(comments, CommentsController),
      r.get("/health", () => "ok"),
    ]);
    const container = new Container({ deps: depsRegistry });
    const hono = new Hono();
    container.instance(HTTP_APP, hono);
    new RequestKernel(container).boot();
    new ResponseKernel(container).boot();
    adHoc.mount(hono);
    calls.length = 0;
    expect((await hono.request("/health")).status).toBe(200);
    expect(calls).toEqual([]);
    expect((await app.request("/api/users/7/posts/open")).status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("passes undefined for an endpoint model the route does not bind", async () => {
    const optional = defineContract()({ show: endpoint.get("/:post?").response(anything) });
    const optionalApi = defineApi({ optional: { contract: optional, path: "/api/optionals", scopes: [{ scope: root, dir: "" }] } });
    class OptionalController extends Controller {
      show() { return { ok: true }; }
    }
    const routes = Route.api(optionalApi, (r) => [
      r.bind({}).scope("", { policy: RootPolicy }),
      r.bind({}).contract(optional, OptionalController, { policy: OptionalPostPolicy }),
    ]);
    const container = new Container({ deps: depsRegistry });
    const app = new Hono();
    container.instance(HTTP_APP, app);
    new RequestKernel(container).boot();
    new ResponseKernel(container).boot();
    routes.mount(app);
    scopeAnswers = [null];
    const response = await app.request("/api/optionals");
    expect(response.status).toBe(200);
    expect(calls.map((call) => [call.level, (call.policy as object).constructor.name, call.args])).toEqual([
      ["check", "RootPolicy", [{}]],
      ["authorize", "OptionalPostPolicy", [undefined]],
    ]);
  });

  it("a binding miss is a 404 before the policies, and no policy runs", async () => {
    // The documented order: model binding (404) before policies (403). The policy would deny, but never runs
    scopeAnswers = [false];
    const response = await update(build(), { name: "Ada" }, "missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "NOT_FOUND", message: "Not Found." });
    expect(postLookups).toEqual(["missing"]);
    expect(calls).toEqual([]);
  });
});
