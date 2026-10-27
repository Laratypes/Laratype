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

  it("is served by the contract only: no 0.5 route registers GET or POST /api/users", () => {
    const registered = example.app.routes.filter(
      (route) => route.path === "/api/users" && (route.method === "GET" || route.method === "POST"),
    );
    // The v1 contract's index (GET) and store (POST). A leftover 0.5 GET/POST would add one more of each.
    expect(registered.map((route) => route.method).sort()).toEqual(["GET", "POST"]);
    // The 0.5 routes of the same 0.5 folder stay mounted
    expect(example.app.routes.some((route) => route.path === "/api/users/:user" && route.method === "GET")).toBe(true);
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
});
