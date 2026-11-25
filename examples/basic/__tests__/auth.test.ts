import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { swapAdminLookup, swapAdminSave, swapMemoryAuth, type MemoryAuth, type MemoryAuthOptions } from "./support/auth";
import { bootExample, type BootedExample } from "./support/boot";

// E3 #135: the ported auth surface. The 401s run against the real AuthManager; the authenticated cases swap it for the
// in-memory provider rows of support/auth.ts (real TokenGuard, JWT, contract auth and policy chain; no MySQL).

let example: BootedExample;
let memory: MemoryAuth | undefined;

beforeAll(async () => {
  example = await bootExample();
});

afterEach(() => {
  memory?.restore();
  memory = undefined;
});

afterAll(async () => {
  await example.stop();
});

const install = (options: MemoryAuthOptions = {}) => {
  memory?.restore();
  memory = swapMemoryAuth(example.container, options);
  return memory;
};

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const request = (path: string, init: RequestInit = {}) => example.app.request(path, init);

const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const expectUnauthorized = async (path: string, method = "GET") => {
  const response = await request(path, { method });
  expect(response.status, `${method} ${path}`).toBe(401);
  expect(await response.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthenticated." });
};

describe("contract auth", () => {
  it("answers 401 without a token on every protected route", async () => {
    await expectUnauthorized("/api/users");
    await expectUnauthorized("/api/users", "POST");
    await expectUnauthorized("/api/users/1");
    await expectUnauthorized("/api/me");
    await expectUnauthorized("/api/admin/me");
    await expectUnauthorized("/api/admin/admins/1");
    // Admin registration is admin-only (security round 1): no anonymous admin signup
    await expectUnauthorized("/api/admin/register", "POST");
  });

  it("answers 200 on GET /api/me for a user token", async () => {
    const auth = install();
    const user = auth.user(1);
    const response = await request("/api/me", { headers: bearer(await auth.issue("web", user)) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 1,
      email: "user1@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      age: 36,
      isActive: true,
    });
  });

  it("answers 200 on GET /api/admin/me for an admin token", async () => {
    const auth = install();
    const admin = auth.admin(1);
    const response = await request("/api/admin/me", { headers: bearer(await auth.issue("admin", admin)) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 1,
      email: "admin1@example.com",
      firstName: "Grace",
      lastName: "Hopper",
      age: 45,
    });
  });

  it("answers the derived 403 when AdminPolicy.before refuses a User behind the admin guard", async () => {
    // This proves the policy chain and the ported AdminPolicy.before rule, not a reachable production path: the real
    // admin guard's provider is Admin, and the swap puts a User principal there on purpose.
    const auth = install({ adminProvider: "user" });
    const user = auth.user(1);
    const response = await request("/api/admin/me", { headers: bearer(await auth.issue("admin", user)) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "This action is unauthorized." });
  });

  it("answers 401 for a user token on an admin route (wrong guard claim)", async () => {
    const auth = install();
    const headers = bearer(await auth.issue("web", auth.user(1)));
    const me = await request("/api/admin/me", { headers });
    expect(me.status).toBe(401);
    expect(await me.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthenticated." });

    const register = await postJson("/api/admin/register", {
      email: "new-admin@example.com",
      password: "secret123",
      name: "New Admin",
      firstName: "New",
      lastName: "Admin",
      age: 30,
    }, headers);
    expect(register.status).toBe(401);
    expect(await register.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthenticated." });
  });

  it("answers 401 for a malformed and an expired JWT", async () => {
    const auth = install();
    const malformed = await request("/api/me", { headers: bearer("this-is-not-a-jwt") });
    expect(malformed.status).toBe(401);

    const expired = await request("/api/me", {
      headers: bearer(await auth.issue("web", auth.user(1), -1)),
    });
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthenticated." });
  });
});

describe("admin model binding", () => {
  it("answers 200 for a known admin and 404 for unknown/invalid :admin ids, never 500", async () => {
    // The model-binding lookup is the test seam here: the route resolver, AdminPolicy and response path are real.
    const auth = install();
    const admin = auth.admin(7);
    const token = await auth.issue("admin", admin);
    const lookup = swapAdminLookup();
    try {
      const found = await request("/api/admin/admins/7", { headers: bearer(token) });
      expect(found.status).toBe(200);
      expect(await found.json()).toEqual({
        id: 7,
        email: "admin7@example.com",
        firstName: "Grace",
        lastName: "Hopper",
        age: 45,
      });

      for (const id of ["999", "not-a-number", "999999999999999999999"]) {
        const response = await request(`/api/admin/admins/${id}`, { headers: bearer(token) });
        expect(response.status, id).toBe(404);
        expect(await response.json()).toEqual({ code: "NOT_FOUND", message: "Not Found." });
      }
    } finally {
      lookup.restore();
    }
  });
});

describe("validation", () => {
  it("answers 422 for a missing or non-string register/login field (the admin routes need an admin token)", async () => {
    const auth = install();
    const admin = bearer(await auth.issue("admin", auth.admin(1)));
    const cases: Array<[string, unknown, Record<string, string>?]> = [
      ["/api/register", { email: 1, password: 1, name: 1, firstName: 1, lastName: 1, age: "not-a-number" }],
      ["/api/login", { email: 1, password: 1 }],
      ["/api/admin/register", { email: 1, password: 1, name: 1, firstName: 1, lastName: 1, age: "not-a-number" }, admin],
      ["/api/admin/login", { email: 1, password: 1 }, admin],
      ["/api/register", {}],
      ["/api/login", {}],
    ];
    for (const [path, body, headers] of cases) {
      const response = await postJson(path, body, headers);
      expect(response.status, path).toBe(422);
      const json = (await response.json()) as { code: string; errors: Record<string, string[]> };
      expect(json.code, path).toBe("VALIDATION_ERROR");
      expect(Object.keys(json.errors).length, path).toBeGreaterThan(0);
    }
  });

  it("answers 422 for a password over 128 characters and for an invalid register email", async () => {
    const auth = install();
    const admin = bearer(await auth.issue("admin", auth.admin(1)));
    const long = "a".repeat(129);
    const register = { email: "new@example.com", password: long, name: "New", firstName: "New", lastName: "User", age: 30 };
    const invalidEmail = { ...register, email: "not-an-email", password: "secret123" };
    const cases: Array<[string, unknown, Record<string, string>?]> = [
      ["/api/register", register],
      ["/api/login", { email: "user1@example.com", password: long }],
      ["/api/admin/register", register, admin],
      ["/api/admin/login", { email: "admin1@example.com", password: long }, admin],
      ["/api/register", invalidEmail],
      ["/api/admin/register", invalidEmail, admin],
    ];
    for (const [path, body, headers] of cases) {
      const response = await postJson(path, body, headers);
      expect(response.status, path).toBe(422);
      const json = (await response.json()) as { code: string; errors: Record<string, string[]> };
      expect(json.code, path).toBe("VALIDATION_ERROR");
      expect(json.errors.password ?? json.errors.email, path).toBeDefined();
    }
  });
});

describe("admin registration", () => {
  it("creates an admin for an admin token (the insert is the DB seam)", async () => {
    const auth = install();
    const token = bearer(await auth.issue("admin", auth.admin(1)));
    const save = swapAdminSave();
    try {
      const response = await postJson("/api/admin/register", {
        email: "new-admin@example.com",
        password: "secret123",
        name: "New Admin",
        firstName: "New",
        lastName: "Admin",
        age: 30,
      }, token);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: expect.any(Number),
        email: "new-admin@example.com",
        firstName: "New",
        lastName: "Admin",
        age: 30,
      });
    } finally {
      save.restore();
    }
  });
});

describe("credential rate limit", () => {
  it("answers 429 with Retry-After on the sixth login in the window", async () => {
    const auth = install();
    const email = auth.user(1).email;
    // A dedicated address: a throttled route counts per client, and the memory store keeps the window per process
    const from = { address: "198.51.100.23" };
    const login = () => example.app.request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "wrong" }),
    }, from);
    for (let i = 0; i < 5; i++) expect((await login()).status, `login ${i + 1}`).toBe(401);

    const limited = await login();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(await limited.json()).toEqual({ code: "TOO_MANY_REQUESTS", message: "Too Many Requests." });
  });
});

describe("login", () => {
  it("answers the declared 401 INVALID_CREDENTIALS for a wrong password and an unknown email", async () => {
    const auth = install();
    const user = auth.user(1);

    const wrongPassword = await postJson("/api/login", { email: user.email, password: "wrong" });
    const unknownEmail = await postJson("/api/login", { email: "nobody@example.com", password: "secret" });
    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ code: "INVALID_CREDENTIALS", message: "Invalid credentials" });
    }

    const manual = await postJson("/api/login/manual", { email: user.email, password: "wrong" });
    expect(manual.status).toBe(401);
    expect(await manual.json()).toEqual({ code: "INVALID_CREDENTIALS", message: "Invalid credentials" });
  });

  it("answers the declared 401 for an admin login with a wrong password", async () => {
    const auth = install();
    const admin = auth.admin(1);
    const response = await postJson("/api/admin/login", { email: admin.email, password: "wrong" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "INVALID_CREDENTIALS", message: "Invalid credentials" });
  });
});

describe("public contract routes", () => {
  it("serves GET /api/greeting", async () => {
    const response = await request("/api/greeting");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Hello Laratype, from GreetingService" });
  });

  it("serves the posts contract", async () => {
    const index = await request("/api/posts");
    expect(index.status).toBe(200);
    expect(await index.json()).toEqual({ data: [] });

    const store = await request("/api/posts", { method: "POST" });
    expect(store.status).toBe(201);
    expect(await store.json()).toEqual({});
  });
});
