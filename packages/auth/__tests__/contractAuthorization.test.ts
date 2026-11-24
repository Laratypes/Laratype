// H8 #122: the contract policies run with the real policyCheck / policyAuthorize and the real guard. The route
// wiring with stand-in checks is in packages/http (contractAuthorization.test.ts).
import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Container, depsRegistry, Facade } from "@laratype/core";
import { ContextApi, HTTP_APP } from "@laratype/support";
import { defineApi, defineContract, defineScope, endpoint } from "@laratype/contract";
import type { ContractPrefix } from "@laratype/contract";
import { Controller, RequestKernel, ResponseKernel, Route, contractAuth, defineMiddleware, registerContractAuth } from "@laratype/http";
import { AuthManager } from "../src";

declare module "@laratype/contract" {
  interface GuardRegistry {
    web: true;
  }
}

const anything = { "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }) } } as const;

class User {
  constructor(readonly id: number) {}
}
const user = new User(1);
const registered: Record<string, User | false> = { web: false };
const manager = {
  defaultGuard: "web",
  guard(name: string = "web") {
    return { name, user: async () => registered[name] ?? false };
  },
};

const calls: string[] = [];
const lookups: string[] = [];
let rootAnswer: boolean | null = null;
let beforeAnswer: boolean | null = null;
let updateAnswer: unknown = true;
let scopePost: PostModel | undefined;
let endpointPost: PostModel | undefined;
let scopeBefore: boolean | null = null;
let scopeAbility: unknown = true;
let outerBefore: boolean | null = null;
let outerAbility: unknown = true;
let innerBefore: boolean | null = null;
let innerAbility: unknown = true;

class PostModel {
  static readonly primaryKey = "id";
  static async findByRouteKey(key: string) {
    lookups.push(key);
    return new PostModel(key);
  }
  constructor(readonly id: string) {}
}

class RootPolicy {
  before(current: User, ability: string, params: { post?: PostModel }) {
    calls.push(`scope:${ability}`);
    scopePost = params.post;
    return rootAnswer;
  }
}

class PostPolicy {
  before(current: User, ability: string, post: PostModel) {
    calls.push(`before:${ability}:${post.id}:${current.id}`);
    endpointPost = post;
    return beforeAnswer;
  }
  update(current: User, post: PostModel) {
    calls.push(`update:${post.id}:${current.id}`);
    endpointPost = post;
    return updateAnswer;
  }
}

/** A scope with both halves: a `before` true is the bypass, an ability true passes only this scope. */
class AbilityScopePolicy {
  before() {
    calls.push("scope-before");
    return scopeBefore;
  }
  update() {
    calls.push("scope-ability");
    return scopeAbility;
  }
}

class OuterScopePolicy {
  before() {
    calls.push("outer-before");
    return outerBefore;
  }
  update() {
    calls.push("outer-ability");
    return outerAbility;
  }
}

class InnerScopePolicy {
  before() {
    calls.push("inner-before");
    return innerBefore;
  }
  update() {
    calls.push("inner-ability");
    return innerAbility;
  }
}

/** The scope policies of the no-endpoint-policy tree: one allows by its ability, one only falls through. */
class AllowScopePolicy {
  index() {
    calls.push("plain-ability");
    return true;
  }
}

class FallthroughScopePolicy {
  before() {
    calls.push("plain-before");
    return null;
  }
}

const root = defineScope()({ auth: true, authorize: true });
const posts = defineContract()({ update: endpoint.patch("/:post").response(anything) });
const typo = defineContract()({ remove: endpoint.delete("/:post").response(anything) });
const appApi = defineApi({
  posts: { contract: posts, path: "/api/posts", scopes: [{ scope: root, dir: "" }] },
  typo: { contract: typo, path: "/api/typos", scopes: [{ scope: root, dir: "" }] },
});

// The A1 rule: a scope's ability true passes only that scope; a scope's before true is the bypass.
const abilityRoot = defineScope()({ auth: true, authorize: true });
const ability = defineContract()({ update: endpoint.patch("/:post").response(anything) });
const abilityApi = defineApi({ ability: { contract: ability, path: "/api/ability", scopes: [{ scope: abilityRoot, dir: "" }] } });

const plainRoot = defineScope()({ auth: true, authorize: true });
const plain = defineContract()({ index: endpoint.get("/").response(anything) });
const plainApi = defineApi({ plain: { contract: plain, path: "/api/plain", scopes: [{ scope: plainRoot, dir: "" }] } });

const outer = defineScope()({ auth: true, authorize: true });
const inner = defineScope<ContractPrefix<"/api/teams/:team", [typeof outer]>>()({ authorize: true });
const nested = defineContract<ContractPrefix<"/api/teams/:team/posts", [typeof outer, typeof inner]>>()({
  update: endpoint.patch("/:post").response(anything),
});
const nestedApi = defineApi({
  nested: { contract: nested, path: "/api/teams/:team/posts", scopes: [{ scope: outer, dir: "" }, { scope: inner, dir: "teams/[team]" }] },
});

class PostController extends Controller {
  update() { return { updated: true }; }
}
class TypoController extends Controller {
  remove() { return { removed: true }; }
}
class AbilityController extends Controller {
  update() { return { updated: true }; }
}
class PlainController extends Controller {
  index() { return { ok: true }; }
}
class NestedController extends Controller {
  update() { return { updated: true }; }
}

/** A fresh app for one of the rule's trees. */
const mountApp = (api: any, build: (r: any) => unknown[]) => {
  const container = new Container({ deps: depsRegistry });
  const hono = new Hono();
  container.instance(HTTP_APP, hono);
  container.instance(AuthManager, manager as unknown as AuthManager);
  new RequestKernel(container).boot();
  new ResponseKernel(container).boot();
  Route.api(api, build as never).mount(hono);
  return hono;
};

const app = () => {
  const container = new Container({ deps: depsRegistry });
  const hono = new Hono();
  container.instance(HTTP_APP, hono);
  container.instance(AuthManager, manager as unknown as AuthManager);
  new RequestKernel(container).boot();
  new ResponseKernel(container).boot();
  Route.api(appApi, (r) => [
    r.bind({ post: PostModel }).scope("", { policy: RootPolicy }),
    r.bind({ post: PostModel }).contract(posts, PostController, { policy: PostPolicy }),
    r.bind({ post: PostModel }).contract(typo, TypoController),
  ]).mount(hono);
  return hono;
};

const patch = (path = "/api/posts/9") => app().request(path, { method: "PATCH" });
const remove = () => app().request("/api/typos/9", { method: "DELETE" });

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  registered.web = false;
  calls.length = 0;
  lookups.length = 0;
  rootAnswer = null;
  beforeAnswer = null;
  updateAnswer = true;
  scopePost = undefined;
  endpointPost = undefined;
  scopeBefore = null;
  scopeAbility = true;
  outerBefore = null;
  outerAbility = true;
  innerBefore = null;
  innerAbility = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  Facade.setFacadeApplication(undefined);
});

describe("contract authorization with the real checks", () => {
  it("answers the 401 before the 403 when unauthenticated, and no policy runs", async () => {
    const response = await patch();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthenticated." });
    expect(calls).toEqual([]);
    expect(lookups).toEqual([]);
  });

  it("runs the scope hook with (user, ability, params) and the endpoint policy with (user, post)", async () => {
    registered.web = user;
    const response = await patch();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: true });
    expect(calls).toEqual(["scope:update", "before:update:9:1", "update:9:1"]);
    expect(lookups).toEqual(["9"]);
    // The same H7-resolved instance reaches the scope hook and the endpoint policy
    expect(scopePost).toBeInstanceOf(PostModel);
    expect(endpointPost).toBe(scopePost);
  });

  it("a scope before that allows skips the endpoint policy; one that denies is the 403", async () => {
    registered.web = user;
    rootAnswer = true;
    expect((await patch()).status).toBe(200);
    expect(calls).toEqual(["scope:update"]);

    calls.length = 0;
    rootAnswer = false;
    const denied = await patch();
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ code: "FORBIDDEN", message: "This action is unauthorized." });
    expect(calls).toEqual(["scope:update"]);
  });

  it("an endpoint before that falls through runs the method; false denies without it; true allows without it", async () => {
    registered.web = user;
    beforeAnswer = false;
    const denied = await patch();
    expect(denied.status).toBe(403);
    expect(calls).toEqual(["scope:update", "before:update:9:1"]);

    calls.length = 0;
    beforeAnswer = true;
    expect((await patch()).status).toBe(200);
    expect(calls).toEqual(["scope:update", "before:update:9:1"]);

    calls.length = 0;
    beforeAnswer = null;
    updateAnswer = false;
    expect((await patch()).status).toBe(403);
    expect(calls).toEqual(["scope:update", "before:update:9:1", "update:9:1"]);
  });

  it("only an explicit true allows: a truthy non-boolean method result is the 403", async () => {
    registered.web = user;
    updateAnswer = "yes";
    const response = await patch();
    expect(response.status).toBe(403);
    expect(calls.at(-1)).toBe("update:9:1");
  });

  it("a typo'd ability that decides nothing is the 403, never a fall-through allow", async () => {
    registered.web = user;
    const response = await remove();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "This action is unauthorized." });
    // The scope hook ran; it has no `remove` method, and no endpoint policy was mounted
    expect(calls).toEqual(["scope:remove"]);
  });

  it("a non-object user is a guest: the 403 without running a policy", async () => {
    const slot = Symbol.for("laratype.http.contractAuth");
    const brand = Symbol.for("laratype.auth.contractAuthFactory");
    const real = (globalThis as Record<symbol, unknown>)[slot];
    let guestUser: unknown = false;
    const standIn = (guard: unknown) => {
      void guard;
      return defineMiddleware<{ user?: unknown }>(async (_request, next) => {
        ContextApi.setUser(guestUser);
        return next();
      });
    };
    Object.defineProperty(standIn, brand, { value: true });
    registerContractAuth(standIn as never);
    try {
      for (const guest of [false, 0, "", Number.NaN]) {
        guestUser = guest;
        calls.length = 0;
        const response = await patch();
        expect(response.status).toBe(403);
        expect(calls).toEqual([]);
      }
    } finally {
      registerContractAuth(real as never);
    }
  });

  it("does not throw when the registration module is evaluated twice (a reload, or a second copy of the package)", async () => {
    const slot = Symbol.for("laratype.http.contractPolicies");
    const first = (globalThis as Record<symbol, unknown>)[slot];
    expect(first).toBeDefined();
    vi.resetModules();
    await expect(import("../src/contractPolicies")).resolves.toBeDefined();
    const second = (globalThis as Record<symbol, unknown>)[slot];
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it("keeps the auth slot functions after the contract policy registration", () => {
    expect(contractAuth()).toBeDefined();
    const value = (globalThis as Record<symbol, unknown>)[Symbol.for("laratype.http.contractPolicies")] as object;
    expect((value as Record<symbol, unknown>)[Symbol.for("laratype.auth.contractPolicyChecks")]).toBe(true);
  });
});

describe("the scope ability passes only its own scope (A1)", () => {
  const abilityApp = () => mountApp(abilityApi, (r) => [
    r.bind({ post: PostModel }).scope("", { policy: AbilityScopePolicy }),
    r.bind({ post: PostModel }).contract(ability, AbilityController, { policy: PostPolicy }),
  ]);
  const patchAbility = () => abilityApp().request("/api/ability/9", { method: "PATCH" });

  it("a scope method true does not skip the endpoint policy: an endpoint denial is the 403", async () => {
    registered.web = user;
    scopeBefore = null;
    scopeAbility = true;
    beforeAnswer = false;
    const response = await patchAbility();
    expect(response.status).toBe(403);
    expect(calls).toEqual(["scope-before", "scope-ability", "before:update:9:1"]);
  });

  it("a scope before true is the bypass: the endpoint denial does not run", async () => {
    registered.web = user;
    scopeBefore = true;
    scopeAbility = true;
    beforeAnswer = false;
    const response = await patchAbility();
    expect(response.status).toBe(200);
    expect(calls).toEqual(["scope-before"]);
  });

  it("a scope method true allows with no endpoint policy; every scope falling through is the 403", async () => {
    registered.web = user;
    const allowed = await mountApp(plainApi, (r) => [
      r.bind({}).scope("", { policy: AllowScopePolicy }),
      r.bind({}).contract(plain, PlainController),
    ]).request("/api/plain");
    expect(allowed.status).toBe(200);
    expect(calls).toEqual(["plain-ability"]);

    calls.length = 0;
    const denied = await mountApp(plainApi, (r) => [
      r.bind({}).scope("", { policy: FallthroughScopePolicy }),
      r.bind({}).contract(plain, PlainController),
    ]).request("/api/plain");
    expect(denied.status).toBe(403);
    expect(calls).toEqual(["plain-before"]);
  });
});

describe("nested scopes and the A1 rule", () => {
  const nestedApp = () => mountApp(nestedApi, (r) => [
    r.bind({ post: PostModel }).scope("", { policy: OuterScopePolicy }),
    r.bind({ post: PostModel }).scope("teams/[team]", { policy: InnerScopePolicy }),
    r.bind({ post: PostModel }).contract(nested, NestedController, { policy: PostPolicy }),
  ]);
  const patchNested = () => nestedApp().request("/api/teams/7/posts/9", { method: "PATCH" });

  it("an outer method true does not skip an inner before false: the 403", async () => {
    registered.web = user;
    outerAbility = true;
    innerBefore = false;
    const response = await patchNested();
    expect(response.status).toBe(403);
    expect(calls).toEqual(["outer-before", "outer-ability", "inner-before"]);
  });

  it("an outer method true and an inner method true let the endpoint policy decide", async () => {
    registered.web = user;
    outerAbility = true;
    innerAbility = true;
    const allowed = await patchNested();
    expect(allowed.status).toBe(200);
    expect(calls).toEqual(["outer-before", "outer-ability", "inner-before", "inner-ability", "before:update:9:1", "update:9:1"]);

    calls.length = 0;
    updateAnswer = false;
    const denied = await patchNested();
    expect(denied.status).toBe(403);
    expect(calls.at(-1)).toBe("update:9:1");
  });
});
