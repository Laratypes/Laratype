// Type tests for middleware classes with constructor DI (H21 #269): run by `bunx vitest run --project types`.
// The 0.5 http sources need the runtime globals and the HonoRequest overload that the build includes.
/// <reference path="../../../global.d.ts" />
/// <reference path="../../src/overload.d.ts" />
import { describe, test } from "vitest";
import { defineApi, defineContract, endpoint } from "@laratype/contract";
import { Controller, Middleware, RequestKernel, Route, defineRouteGroup } from "../../src/index";

const users = defineContract()({ index: endpoint.get("/") });
const appApi = defineApi({ users: { contract: users, path: "/api/users", scopes: [] } });

class UserController extends Controller { index() {} }

class Logger { log(_message: string) {} }

/** A middleware whose constructor requires a dependency: the container injects it at request time (H21 #269). */
class Audit extends Middleware {
  constructor(private readonly logger: Logger) { super(); }
}

class NotMiddleware {
  constructor(private readonly logger: Logger) {}
}

/** Type-level checks only: the body is type-checked but never run. */
const typeOnly = (_fn: () => void) => {};

describe("middleware classes with constructor dependencies", () => {
  test("a 0.5 Route accepts them in middleware and withoutMiddleware", () => {
    typeOnly(() => {
      defineRouteGroup("/api", {
        path: "/",
        middleware: [Audit],
        withoutMiddleware: [Audit],
        children: [{ path: "/users", method: "get", controller: [UserController, "index"] }],
      }, null as never);
    });
  });

  test("Route.api accepts them in r.middleware() and an endpoints callback", () => {
    typeOnly(() => {
      Route.api(appApi, (r) => [
        r.middleware(Audit).contract(users, UserController, { endpoints: { index: (r) => r.middleware(Audit) } }),
      ]);
    });
  });

  test("RequestKernel.handle accepts them", () => {
    typeOnly(() => {
      RequestKernel.handle({
        method: "get",
        path: "/users",
        controller: [UserController, "index"],
        middleware: [Audit],
      });
    });
  });

  test("a class that is not a middleware is still rejected", () => {
    typeOnly(() => {
      // @ts-expect-error a middleware extends Middleware
      defineRouteGroup("/api", { path: "/", middleware: [NotMiddleware], children: [] }, null as never);
      // @ts-expect-error a middleware extends Middleware
      defineRouteGroup("/api", { path: "/", withoutMiddleware: [NotMiddleware], children: [] }, null as never);
      // @ts-expect-error r.middleware() takes middleware classes
      Route.api(appApi, (r) => [r.middleware(NotMiddleware).contract(users, UserController)]);
      RequestKernel.handle({
        method: "get",
        path: "/users",
        controller: [UserController, "index"],
        // @ts-expect-error RequestKernel.handle takes middleware classes
        middleware: [NotMiddleware],
      });
    });
  });
});
