import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserDto } from "../app/api/users";
import { bootExample, type BootedExample } from "./support/boot";

// E1 #111: the v1 users slice through the example's Hono app, in process. The app boots with every provider of
// app/config/providers.ts (no stub), and the router serves the contract from app/api/users.ts.

let example: BootedExample;

beforeAll(async () => {
  example = await bootExample();
});

afterAll(async () => {
  await example.stop();
});

const json = async (path: string, init?: RequestInit) => {
  const response = await example.app.request(path, init);
  return { response, body: await response.json() };
};

const store = (body: unknown) => json("/api/users", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("GET /api/users", () => {
  it("answers 200 with the list", async () => {
    const { response, body } = await json("/api/users");
    expect(response.status).toBe(200);
    expect(body).toEqual({ data: expect.any(Array) });
  });

  it("is served by the contract alone: no 0.5 route keeps a /api/users path", async () => {
    const registered = example.app.routes.filter(
      (route) => route.path === "/api/users" && (route.method === "GET" || route.method === "POST"),
    );
    // The v1 contract's index (GET) and store (POST). A leftover 0.5 GET/POST would add one more of each.
    expect(registered.map((route) => route.method).sort()).toEqual(["GET", "POST"]);

    // /api/users is the v1 contract's alone (E1 #344): GET /api/users/:id is its show route (param `id`), and the 0.5
    // GET /api/users/:user, PATCH /api/users/:activeUser and DELETE /api/users/:id children are all gone.
    const paths = (method: string) =>
      new Set(example.app.routes.filter((route) => route.method === method).map((route) => route.path));
    expect(paths("GET")).not.toContain("/api/users/:user");
    expect(paths("PATCH")).not.toContain("/api/users/:activeUser");
    expect(paths("DELETE")).not.toContain("/api/users/:id");

    // And the v1 controller answers it: the created record comes back as is. The 0.5 view at /:user, now removed, was
    // registered after this v1 route, so Hono matched the v1 one first.
    const created = (await store({ name: "Ada Byron", email: "ada.byron@example.com" })).body;
    const { response, body } = await json(`/api/users/${created.id}`);
    expect(response.status).toBe(200);
    expect(body).toEqual(created);
  });
});

describe("PATCH and DELETE /api/users/:id", () => {
  it("answer 404: the 0.5 children are gone and the v1 slice has no update or delete yet", async () => {
    // A re-added 0.5 child would reach AuthGuard (401) or its controller, not a route-less 404
    for (const method of ["PATCH", "DELETE"]) {
      expect((await example.app.request("/api/users/1", { method })).status, method).toBe(404);
    }
  });
});

describe("POST /api/users", () => {
  it("answers 201 with the stored user", async () => {
    const { response, body } = await store({ name: "Ada", email: "ada@example.com" });
    expect(response.status).toBe(201);
    expect(body).toEqual({ id: expect.any(Number), name: "Ada", email: "ada@example.com" });

    // The body matches the endpoint's response schema (UserDto), not just its keys
    expect(UserDto.safeParse(body).success).toBe(true);
  });

  it("answers 422 with the catalog validation body for an invalid body", async () => {
    const { response, body } = await store({ name: "", email: "not-an-email" });
    expect(response.status).toBe(422);
    expect(body).toEqual({
      code: "VALIDATION_ERROR",
      message: "The given data was invalid.",
      errors: { name: expect.any(Array), email: expect.any(Array) },
    });
    expect(body.errors.name.every((message: unknown) => typeof message === "string")).toBe(true);
    expect(body.errors.email.every((message: unknown) => typeof message === "string")).toBe(true);
  });
});

describe("GET /api/users/:id", () => {
  it("answers 200 with the user", async () => {
    const created = (await store({ name: "Grace", email: "grace@example.com" })).body;
    const { response, body } = await json(`/api/users/${created.id}`);
    expect(response.status).toBe(200);
    expect(body).toEqual(created);
  });

  it("answers 404 with the catalog NOT_FOUND body for an unknown id", async () => {
    const { response, body } = await json("/api/users/999999");
    expect(response.status).toBe(404);
    expect(body).toEqual({ code: "NOT_FOUND", message: "Not Found." });
  });

  it("answers 404 for ids Number() reads as the stored one: 0x<hex>, <id>e0 and 0<id>", async () => {
    // `0x<hex>`, `<id>e0` and `0<id>` all read back as the same number under Number(), so a loose parse would answer
    // 200. The stored user is this test's own: another test's fixture is skipped when `vitest -t` runs this one alone.
    const created = (await store({ name: "Malformed Id", email: "malformed.id@example.com" })).body;
    const { response } = await json(`/api/users/${created.id}`);
    expect(response.status).toBe(200);

    for (const malformed of [`0x${created.id.toString(16)}`, `${created.id}e0`, `0${created.id}`]) {
      const { response, body } = await json(`/api/users/${malformed}`);
      expect(response.status, malformed).toBe(404);
      expect(body).toEqual({ code: "NOT_FOUND", message: "Not Found." });
    }
  });
});
