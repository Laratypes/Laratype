import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { swapMemoryAuth, type MemoryAuth } from "./support/auth";
import { bootExample, type BootedExample } from "./support/boot";

// E1 #344 + E3 #135: the users store belongs to the UserService singleton of the app container (docs/v1/di.md ›
// Decorators), not to module state, so a second boot in the same process starts empty. The contract auth step is real;
// only the provider's user lookup is in memory (support/auth.ts).

describe("users store", () => {
  let example: BootedExample | undefined;
  let memory: MemoryAuth | undefined;
  let auth: Record<string, string>;

  const boot = async () => {
    const booted = await bootExample();
    const swapped = swapMemoryAuth(booted.container);
    return {
      booted,
      swapped,
      headers: { authorization: `Bearer ${await swapped.issue("web", swapped.user(1))}` },
    };
  };

  beforeAll(async () => {
    const booted = await boot();
    example = booted.booted;
    memory = booted.swapped;
    auth = booted.headers;
  });

  afterAll(async () => {
    // A failed second boot leaves `example` undefined, so the stopped app is never stopped twice
    memory?.restore();
    await example?.stop();
    example = undefined;
    memory = undefined;
  });

  it("keeps the users of a boot between two requests", async () => {
    const booted = example;
    if (!booted) throw new Error("users.boot.test.ts: the app was not booted");

    const stored = await booted.store({ name: "Ada", email: "ada@example.com" }, auth);
    expect(stored.response.status).toBe(201);
    // The one UserService instance of this boot kept the user between two requests
    expect((await booted.requestJson("/api/users", { headers: auth })).body).toEqual({ data: [stored.body] });
  });

  it("starts empty on a second boot in the same process", async () => {
    const current = example;
    if (!current) throw new Error("users.boot.test.ts: the app was not booted");
    // Seed this boot too, so the assertion does not rely on the first test having run (the file alone must prove it)
    const stored = await current.store({ name: "Grace", email: "grace@example.com" }, auth);
    expect(stored.response.status).toBe(201);
    memory?.restore();
    memory = undefined;
    await current.stop();
    example = undefined;

    const booted = await boot();
    example = booted.booted;
    memory = booted.swapped;

    // A new container builds a new singleton: nothing from the previous boot survives
    expect((await booted.booted.requestJson("/api/users", { headers: booted.headers })).body).toEqual({ data: [] });
  });
});
