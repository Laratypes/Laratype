import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@laratype/client";
import type { ClientOf } from "@laratype/client";
import { appApi } from "$api";
import { UserDto } from "../app/api/users";
import { bootExample, type BootedExample } from "./support/boot";

// E1 #111: the same users cases through @laratype/client (docs/v1/client.md › createClient and Result union). The
// client is built from the generated appApi only (contracts, never routes), and its fetch drives the example's Hono
// app in process, as the PM decision on #111 records.

let example: BootedExample;
let api: ClientOf<typeof appApi>;

beforeAll(async () => {
  example = await bootExample();
  api = createClient(appApi, {
    baseUrl: "http://localhost",
    fetch: (url, init) => example.app.request(url, init),
  });
});

afterAll(async () => {
  await example.stop();
});

describe("users.index", () => {
  it("resolves ok with the list and the 200 the contract declares", async () => {
    const result = await api.users.index();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ data: expect.any(Array) });
  });
});

describe("users.store", () => {
  it("resolves ok with the stored user and the 201 the contract declares", async () => {
    const result = await api.users.store({ body: { name: "Ada", email: "ada@example.com" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(201);
    expect(result.data).toEqual({ id: expect.any(Number), name: "Ada", email: "ada@example.com" });
    expect(UserDto.safeParse(result.data).success).toBe(true);
  });

  it("resolves the 422 error branch with the catalog VALIDATION_ERROR body", async () => {
    const result = await api.users.store({ body: { name: "", email: "not-an-email" } });
    expect(result.ok).toBe(false);
    if (result.ok || result.unexpected) return;
    expect(result.status).toBe(422);
    expect(result.code).toBe("VALIDATION_ERROR");
    expect(result.error.message).toBe("The given data was invalid.");
    expect(result.error.errors.name).toEqual(expect.any(Array));
    expect(result.error.errors.email).toEqual(expect.any(Array));
  });
});

describe("users.show", () => {
  it("resolves ok with the user and the 200 the contract declares", async () => {
    const created = await api.users.store({ body: { name: "Grace", email: "grace@example.com" } });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await api.users.show({ params: { id: created.data.id } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(200);
    expect(result.data).toEqual(created.data);
  });

  it("resolves the 404 error branch with the catalog NOT_FOUND body", async () => {
    const result = await api.users.show({ params: { id: 999999 } });
    expect(result.ok).toBe(false);
    if (result.ok || result.unexpected) return;
    expect(result.status).toBe(404);
    expect(result.code).toBe("NOT_FOUND");
    expect(result.error.message).toBe("Not Found.");
  });
});
