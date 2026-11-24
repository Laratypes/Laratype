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
type ScopeAnswer = { by: "before" | "ability"; answer: boolean };
// A wrong shape can reach the kernel from an older @laratype/auth copy registered on the slot (H8 #122): the kernel
// fails closed on it, so the tests can put one here
let scopeAnswers: unknown[] = [];
let endpointResult: "allow" | "deny" | "throw" = "allow";

const checks: ContractPolicyChecks = {
  async check(policy, user, ability, ...args) {
    calls.push({ level: "check", policy, user, ability, args });
    return (scopeAnswers.shift() ?? null) as ScopeAnswer | null;
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
    scopeAnswers = [null, { by: "before", answer: false }];
    const response = await update(build());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "This action is unauthorized." });
    expect(calls.map((call) => (call.policy as object).constructor.name)).toEqual(["RootPolicy", "UserPolicy"]);
  });

  it("a scope before that allows skips the inner scopes and the endpoint policy", async () => {
    scopeAnswers = [{ by: "before", answer: true }];
    const response = await update(build());
    expect(response.status).toBe(200);
    expect(calls.map((call) => (call.policy as object).constructor.name)).toEqual(["RootPolicy"]);
    expect(userLookups).toEqual(["7"]);
  });

  it("a scope ability that allows passes that scope only: the inner scope and the endpoint policy still run", async () => {
    scopeAnswers = [{ by: "ability", answer: true }, null];
    const response = await update(build());
    expect(response.status).toBe(200);
    expect(calls.map((call) => [call.level, (call.policy as object).constructor.name])).toEqual([
      ["check", "RootPolicy"],
      ["check", "UserPolicy"],
      ["authorize", "PostPolicy"],
    ]);
  });

  it("an inner denial after an outer ability true is the 403, and the endpoint policy does not run", async () => {
    scopeAnswers = [{ by: "ability", answer: true }, { by: "before", answer: false }];
    const response = await update(build());
    expect(response.status).toBe(403);
    expect(calls.map((call) => (call.policy as object).constructor.name)).toEqual(["RootPolicy", "UserPolicy"]);
  });

  it("a scope ability that allows is enough with no endpoint policy; all-null is the 403", async () => {
    scopeAnswers = [{ by: "ability", answer: true }, null];
    const allowed = await build().request("/api/users/7/comments");
    expect(allowed.status).toBe(200);
    expect(calls.map((call) => call.level)).toEqual(["check", "check"]);

    calls.length = 0;
    scopeAnswers = [null, null];
    const denied = await build().request("/api/users/7/comments");
    expect(denied.status).toBe(403);
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

  // H8 #122: a check of the wrong shape must be the 403, never the allow of a scope-only route. A bare `false` used to
  // fall through to `explicitlyAllowed = true` (a denial read as an allow), and a `before` tag without `true` used to
  // be the bypass.
  it("a boolean false is the 403 on a scope-only route, never an allow", async () => {
    scopeAnswers = [false];
    const response = await build().request("/api/users/7/comments");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "This action is unauthorized." });
    expect(calls.map((call) => (call.policy as object).constructor.name)).toEqual(["RootPolicy"]);
  });

  it("a boolean true is the 403 too: a bare true is not a tagged ability allow", async () => {
    scopeAnswers = [true];
    const response = await build().request("/api/users/7/comments");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "This action is unauthorized." });
    expect(calls.map((call) => (call.policy as object).constructor.name)).toEqual(["RootPolicy"]);
  });

  it("a before tag whose answer is undefined is the 403, not the bypass", async () => {
    scopeAnswers = [{ by: "before", answer: undefined }];
    const response = await build().request("/api/users/7/comments");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "This action is unauthorized." });
    expect(calls.map((call) => (call.policy as object).constructor.name)).toEqual(["RootPolicy"]);
  });

  it("an unknown tag with answer true is the 403, not an explicit allow", async () => {
    scopeAnswers = [{ by: "other", answer: true }];
    const response = await build().request("/api/users/7/comments");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "This action is unauthorized." });
    // The unknown tag is the 403 at once: it never sets the explicit allow nor passes to the inner scope
    expect(calls.map((call) => (call.policy as object).constructor.name)).toEqual(["RootPolicy"]);
  });

  it("runs before the 422: an invalid body is a 403 when the policy denies", async () => {
    scopeAnswers = [null, null];
    expect((await update(build(), {})).status).toBe(422);
    calls.length = 0;
    scopeAnswers = [{ by: "before", answer: false }];
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
    scopeAnswers = [{ by: "before", answer: false }];
    const response = await update(build(), { name: "Ada" }, "missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "NOT_FOUND", message: "Not Found." });
    expect(postLookups).toEqual(["missing"]);
    expect(calls).toEqual([]);
  });
});
