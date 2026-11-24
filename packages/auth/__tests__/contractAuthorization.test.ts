// H8 #122: the contract policies run with the real policyCheck / policyAuthorize and the real guard. The route
// wiring with stand-in checks is in packages/http (contractAuthorization.test.ts).
import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Container, depsRegistry, Facade } from "@laratype/core";
import { ContextApi, HTTP_APP } from "@laratype/support";
import { defineApi, defineContract, defineScope, endpoint } from "@laratype/contract";
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

const root = defineScope()({ auth: true, authorize: true });
const posts = defineContract()({ update: endpoint.patch("/:post").response(anything) });
const typo = defineContract()({ remove: endpoint.delete("/:post").response(anything) });
const appApi = defineApi({
  posts: { contract: posts, path: "/api/posts", scopes: [{ scope: root, dir: "" }] },
  typo: { contract: typo, path: "/api/typos", scopes: [{ scope: root, dir: "" }] },
});

class PostController extends Controller {
  update() { return { updated: true }; }
}
class TypoController extends Controller {
  remove() { return { removed: true }; }
}

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
