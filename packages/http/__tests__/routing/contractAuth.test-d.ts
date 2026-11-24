// Type tests for the contract auth (A2 #120): the auth capability's user in the route proof.
// The auth Register augmentation of typedRegister.test-d.ts applies to this program too.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, expectTypeOf, test } from "vitest";
import { defineApi, defineContract, defineScope, endpoint } from "@laratype/contract";
import type { GuardUser } from "@laratype/contract";
import { Controller, Route, contractAuth, defineMiddleware } from "../../src/index";
import type { AnyTypedMiddleware, ContractAuthFactory, Ctx, RouteProof } from "../../src/index";

const defaultAuth = defineContract()({ index: endpoint.get("/") }, { auth: true });
const namedAuth = defineContract()(
  { index: endpoint.get("/"), admin: endpoint.get("/admin").auth("admin") },
  { auth: true },
);
const publicRoute = defineContract()({ index: endpoint.get("/").public() }, { auth: true });

const defaultApi = defineApi({ posts: { contract: defaultAuth, path: "/api/posts", scopes: [] } });
const namedApi = defineApi({ posts: { contract: namedAuth, path: "/api/posts", scopes: [] } });
const publicApi = defineApi({ open: { contract: publicRoute, path: "/api/open", scopes: [] } });

describe("auth from the contract (A2 #120)", () => {
  test("auth: true provides the registered default user", () => {
    class Reads extends Controller {
      index(ctx: Ctx<typeof defaultAuth.index, { user: GuardUser<true> }>) { void ctx.user }
    }
    expectTypeOf<RouteProof<typeof defaultApi, typeof defaultAuth, Reads, { policy: undefined }>>().toEqualTypeOf<unknown>();
  });

  test("auth: '<guard>' provides that guard's registered user, and an endpoint guard wins", () => {
    class Reads extends Controller {
      // The contract's auth: true is the default guard; the endpoint's .auth('admin') is nearer.
      index(ctx: Ctx<typeof namedAuth.index, { user: GuardUser<true> }>) { void ctx.user }
      admin(ctx: Ctx<typeof namedAuth.admin, { user: GuardUser<"admin"> }>) { void ctx.user }
    }
    expectTypeOf<RouteProof<typeof namedApi, typeof namedAuth, Reads, { policy: undefined }>>().toEqualTypeOf<unknown>();
  });

  test("a public route provides no user", () => {
    class Plain extends Controller {
      index() {}
    }
    expectTypeOf<RouteProof<typeof publicApi, typeof publicRoute, Plain, { policy: undefined }>>().toEqualTypeOf<unknown>();

    class NeedsUser extends Controller {
      index(ctx: Ctx<typeof publicRoute.index, { user: GuardUser<true> }>) { void ctx.user }
    }
    expectTypeOf<RouteProof<typeof publicApi, typeof publicRoute, NeedsUser, { policy: undefined }>>().toHaveProperty(
      "open.index: handler requires `user`, route has no auth (add auth: true or a guard to the endpoint, its contract or a scope)",
    )
    // @ts-expect-error open.index: handler requires `user`, route has no auth
    Route.api(publicApi, (r) => [r.contract(publicRoute, NeedsUser)])
  });

  test("a user of another type than the guard's is diagnosed at the guard", () => {
    class NeedsName extends Controller {
      index(ctx: Ctx<typeof defaultAuth.index, { user: { name: string } }>) { void ctx.user }
    }
    expectTypeOf<RouteProof<typeof defaultApi, typeof defaultAuth, NeedsName, { policy: undefined }>>().toHaveProperty(
      "posts.index: `user` of the ctx does not match the guard's user type (the auth capability's guard)",
    )
    // @ts-expect-error posts.index: `user` of the ctx does not match the guard's user type (the auth capability's guard)
    Route.api(defaultApi, (r) => [r.contract(defaultAuth, NeedsName)])
  });

  test("route middleware that adds user still wins its type", () => {
    const override = defineMiddleware<{ user: { id: string } }>((_request, next) => next({ user: { id: "1" } }))
    class Reads extends Controller {
      index(ctx: Ctx<typeof defaultAuth.index, { user: { id: string } }>) { void ctx.user }
    }
    expectTypeOf<RouteProof<typeof defaultApi, typeof defaultAuth, Reads, { policy: undefined }, { user: { id: string } }>>().toEqualTypeOf<unknown>()
    class NeedsNumber extends Controller {
      index(ctx: Ctx<typeof defaultAuth.index, { user: { id: number } }>) { void ctx.user }
    }
    // The middleware's value is what the runtime keeps, so the diagnosis is the generic one, not the guard's.
    expectTypeOf<RouteProof<typeof defaultApi, typeof defaultAuth, NeedsNumber, { policy: undefined }, { user: { id: string } }>>().toHaveProperty(
      "posts.index: `user` provided by the route does not match the handler (missing .bind()?)",
    )
    void override
  });

  test("the contract auth slot types", () => {
    expectTypeOf<Parameters<ContractAuthFactory>>().toEqualTypeOf<[guard: true | string]>();
    expectTypeOf<ReturnType<ContractAuthFactory>>().toEqualTypeOf<AnyTypedMiddleware>();
    expectTypeOf(contractAuth()).toEqualTypeOf<ContractAuthFactory | undefined>();
  });

  test("a scope's auth applies to every endpoint under it", () => {
    const scoped = defineContract()({ index: endpoint.get("/") });
    const scope = defineScope()({ auth: "admin" });
    const scopedApi = defineApi({ scoped: { contract: scoped, path: "/scoped", scopes: [{ scope, dir: "" }] } });
    class Reads extends Controller {
      index(ctx: Ctx<typeof scoped.index, { user: GuardUser<"admin"> }>) { void ctx.user }
    }
    expectTypeOf<RouteProof<typeof scopedApi, typeof scoped, Reads, { policy: undefined }>>().toEqualTypeOf<unknown>();
  });

  test("a wrong guard name is the argument error naming the registered guards", () => {
    // @ts-expect-error 'nope' is not one of the registered guards
    defineContract()({ index: endpoint.get("/") }, { auth: "nope" })
  });
});
