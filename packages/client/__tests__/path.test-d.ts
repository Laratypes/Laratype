// Type tests for path-style calls (CL4 #140): the path selects the endpoint, and the call is typed as the named style.
import { describe, expectTypeOf, test } from "vitest";
import { createPathClient } from "@laratype/client";
import type { ClientResult, ClientSuccess, PathCall, PathClient, ProvidedHeaders } from "@laratype/client";
import type { ApiTypes } from "@laratype/contract";
import type { AppApi } from "./fixtures/.laratype/api/index.gen";
import type { AppApi as Generated } from "./fixtures/separate-fe/api";

type Api = ApiTypes<AppApi>;
const api = createPathClient<Api>();

/** An endpoint shape with the fields the path types read; `response` tells two same-path endpoints apart. */
type Shape<Response> = {
  method: "get";
  path: "/api/dup";
  params: {};
  query: undefined;
  body: undefined;
  headers: undefined;
  response: Response;
  status: 200;
  errors: never;
};

describe("createPathClient", () => {
  test("the client is one call per HTTP method", () => {
    expectTypeOf(api).toEqualTypeOf<PathClient<Api>>();
    expectTypeOf(api.get).toEqualTypeOf<PathCall<Api, "get">>();
    expectTypeOf(api.post).toEqualTypeOf<PathCall<Api, "post">>();
    expectTypeOf(api.put).toEqualTypeOf<PathCall<Api, "put">>();
    expectTypeOf(api.patch).toEqualTypeOf<PathCall<Api, "patch">>();
    expectTypeOf(api.delete).toEqualTypeOf<PathCall<Api, "delete">>();
  });

  test("a valid call: the result and errors come from the matched endpoint", async () => {
    const result = await api.get("/api/users/:user", { params: { user: 1 } });
    expectTypeOf(result).toEqualTypeOf<ClientResult<Api["users"]["show"]>>();
    if (result.ok) {
      expectTypeOf(result.status).toEqualTypeOf<200>();
      expectTypeOf(result.data).toEqualTypeOf<ClientSuccess<Api["users"]["show"]>["data"]>();
      return;
    }
    if (result.unexpected) {
      expectTypeOf(result.response).toEqualTypeOf<Response | undefined>();
      return;
    }
    expectTypeOf(result.code).toEqualTypeOf<"UNAUTHORIZED" | "TOO_MANY_REQUESTS" | "NOT_FOUND">();
    if (result.code === "NOT_FOUND") {
      expectTypeOf(result.status).toEqualTypeOf<404>();
      expectTypeOf(result.error).toEqualTypeOf<{ message: string }>();
    }
  });

  test("the full path carries the folder [user] param and the endpoint params of a nested contract", async () => {
    // app/api/users/[user]/posts.ts → /api/users/:user/posts/:post: user comes from the folder, post from the endpoint
    const result = await api.patch("/api/users/:user/posts/:post", {
      params: { user: 1, post: 2 },
      body: { title: "T" },
    });
    expectTypeOf(result).toEqualTypeOf<ClientResult<Api["users"]["posts"]["update"]>>();
    if (!result.ok && !result.unexpected) {
      expectTypeOf(result.code).toEqualTypeOf<
        "VALIDATION_ERROR" | "NOT_FOUND" | "UNAUTHORIZED" | "FORBIDDEN" | "TOO_MANY_REQUESTS" | "ACCOUNT_LOCKED"
      >();
    }
  });

  test("query, body and headers are the named style input of the matched endpoint", () => {
    void api.get("/api/users", { query: { page: 2 } });
    void api.get("/api/users/:user/posts", { params: { user: 1 }, query: { q: "x", tags: ["a"] } });
    void api.post("/api/users", { body: { name: "A", email: "a@b.c" }, headers: { "x-tenant": "t" } });
    // the input is optional when nothing in it is required
    void api.get("/api/v1/health");
  });

  test("errors: an unknown path, a wrong method and the missing inputs", () => {
    // @ts-expect-error no GET endpoint at path "/api/nope"
    void api.get("/api/nope");
    // @ts-expect-error no POST endpoint at path "/api/users/:user"
    void api.post("/api/users/:user", { params: { user: 1 } });
    // @ts-expect-error no DELETE endpoint at path "/api/users"
    void api.delete("/api/users");
    // @ts-expect-error no PUT endpoint at path "/api/users/:user"
    void api.put("/api/users/:user", { params: { user: 1 } });
    // @ts-expect-error a missing required folder param
    void api.get("/api/users/:user/posts", {});
    // @ts-expect-error the input is required: the body
    void api.post("/api/users");
    // @ts-expect-error the body must match the schema input
    void api.post("/api/users", { body: { name: 1, email: "a@b.c" }, headers: { "x-tenant": "t" } });
    // @ts-expect-error a required schema header
    void api.post("/api/users", { body: { name: "A", email: "a@b.c" } });
    // @ts-expect-error no body on an endpoint without a body schema
    void api.get("/api/users", { body: {} });
  });

  test("a path must be a literal: a string or template type is rejected, even when the method has one endpoint", () => {
    const path: string = "/api/users/:user";
    // @ts-expect-error createPathClient: the path must be a literal
    void api.get(path);
    const postPath: string = "/api/users";
    // @ts-expect-error createPathClient: the path must be a literal, also when POST has one endpoint
    void api.post(postPath, { body: { name: "A", email: "a@b.c" }, headers: { "x-tenant": "t" } });
    const template: `/api/${string}` = "/api/users";
    // @ts-expect-error createPathClient: a template path is not a literal path of the API
    void api.post(template, { body: { name: "A", email: "a@b.c" }, headers: { "x-tenant": "t" } });
  });

  test("put and delete calls are typed when the API declares them", () => {
    type Removable = {
      things: {
        remove: {
          method: "delete";
          path: "/api/things/:id";
          params: { id: string };
          query: undefined;
          body: undefined;
          headers: undefined;
          response: undefined;
          status: 204;
          errors: never;
        };
        replace: {
          method: "put";
          path: "/api/things/:id";
          params: { id: string };
          query: undefined;
          body: { name: string };
          headers: undefined;
          response: { id: string; name: string };
          status: 200;
          errors: never;
        };
      };
    };
    const removable = createPathClient<Removable>();
    const removed = removable.delete("/api/things/:id", { params: { id: 1 } });
    expectTypeOf(removed).toEqualTypeOf<Promise<ClientResult<Removable["things"]["remove"]>>>();
    void removable.put("/api/things/:id", { params: { id: 1 }, body: { name: "n" } });
  });

  test("a path that matches two endpoints is ambiguous", () => {
    const duplicate = createPathClient<{ a: { x: Shape<string> }; b: { y: Shape<number> } }>();
    // @ts-expect-error more than one endpoint answers GET at path "/api/dup"
    void duplicate.get("/api/dup");
  });

  test("two endpoints with identical types on one path are still ambiguous", () => {
    // a union of endpoint shapes merges identical members; the locations keep both matches
    const identical = createPathClient<{ a: { x: Shape<string> }; b: { y: Shape<string> } }>();
    // @ts-expect-error more than one endpoint answers GET at path "/api/dup"
    void identical.get("/api/dup");
  });

  test("an API type with an index signature is refused: it cannot name endpoint locations", async () => {
    const record = createPathClient<Record<string, Shape<string>>>();
    // @ts-expect-error the API type must declare literal keys
    void record.get("/api/dup");
    // @ts-expect-error every call is refused, whatever path it passes
    void record.post("/api/nope");
    const nested = createPathClient<{ users: Record<string, Shape<string>> }>();
    // @ts-expect-error an index signature under a literal node is found too
    void nested.get("/api/dup");
    const numeric = createPathClient<{ [index: number]: Shape<string> }>();
    // @ts-expect-error a number index signature names no location either
    void numeric.get("/api/dup");
    const patterned = createPathClient<{ [key: `/api/${string}`]: Shape<string> }>();
    // @ts-expect-error a template-literal key is a pattern, not a location
    void patterned.get("/api/dup");
    // the positive control: an API of literal keys still types every call
    const literal = createPathClient<{ a: { x: Shape<string> } }>();
    const result = await literal.get("/api/dup");
    expectTypeOf(result).toEqualTypeOf<ClientResult<Shape<string>>>();
    // a non-tree type argument still compiles the factory (the self-constraint is weak), but no call type-checks
    const nothing = createPathClient<null>();
    // @ts-expect-error no endpoint in a non-tree API
    void nothing.get("/api/dup");
    const str = createPathClient<string>();
    // @ts-expect-error no endpoint in a non-tree API
    void str.get("/api/dup");
  });

  test("an API type with a template-literal or string path is refused: a pattern matches more than one path", () => {
    const patterns = createPathClient<{ users: { archive: Omit<Shape<string>, "path"> & { path: `/api/users/${string}` } } }>();
    // @ts-expect-error the API declares a GET path that is not a single literal
    void patterns.get("/api/users/archive");
    const path: `/api/users/${string}` = "/api/users/archive";
    // @ts-expect-error a call with the pattern itself is refused too: the API type is the problem, not the call path
    void patterns.get(path);
    const wide = createPathClient<{ a: { x: Omit<Shape<string>, "path"> & { path: string } } }>();
    // @ts-expect-error a `string` path type is refused like a pattern
    void wide.get("/api/any");
    // only the method with the pattern is refused: a literal GET path still types its call
    type Mixed = {
      a: {
        x: Shape<string>;
        y: Omit<Shape<number>, "method" | "path"> & { method: "post"; path: `/api/users/${string}` };
      };
    };
    const mixed = createPathClient<Mixed>();
    const got = mixed.get("/api/dup");
    expectTypeOf(got).toEqualTypeOf<Promise<ClientResult<Shape<string>>>>();
    // @ts-expect-error the POST pattern path refuses POST calls, with no effect on GET
    void mixed.post("/api/users/archive");
  });

  test("headers provided by options.headers are optional, with the headers type as the second type argument", () => {
    // A has no value to infer from, so Hd is explicit, as in the manifest overload of createClient
    const withTenant = createPathClient<Api, { "x-tenant": string }>({ headers: { "x-tenant": "t" } });
    expectTypeOf(withTenant).toEqualTypeOf<PathClient<Api, ProvidedHeaders<{ "x-tenant": string }>>>();
    void withTenant.post("/api/users", { body: { name: "A", email: "a@b.c" } });
  });

  test("the second type argument needs options.headers: no client claims a header it never sends", () => {
    // @ts-expect-error options.headers is required with a headers type argument, since the client would claim it sends them
    void createPathClient<Api, { "x-tenant": string }>();
    // @ts-expect-error a headers function provides nothing statically, so it can't satisfy the type argument
    void createPathClient<Api, { "x-tenant": string }>({ headers: () => ({ "x-tenant": "t" }) });
  });

  test("a headers function provides no header to the types: a schema header stays required in the call", () => {
    const dynamic = createPathClient<Api>({ headers: () => ({ "x-tenant": "t" }) });
    expectTypeOf(dynamic).toEqualTypeOf<PathClient<Api>>();
    // @ts-expect-error the function sends x-tenant only at call time, so the call's headers are still required
    void dynamic.post("/api/users", { body: { name: "A", email: "a@b.c" } });
    void dynamic.post("/api/users", { body: { name: "A", email: "a@b.c" }, headers: { "x-tenant": "t" } });
  });

  test("the generated AppApi of a separate repo is a valid type argument", () => {
    const generated = createPathClient<Generated>();
    const result = generated.get("/api/users/:user", { params: { user: 1 } });
    expectTypeOf(result).toEqualTypeOf<Promise<ClientResult<Generated["users"]["show"]>>>();
  });
});
