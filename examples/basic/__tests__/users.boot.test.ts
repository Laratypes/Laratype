import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootExample, type BootedExample } from "./support/boot";

// E1 #344: the users store belongs to the UserService singleton of the app container (docs/v1/di.md › Decorators:
// @Inject and @Injectable), not to module state, so a second boot in the same process starts empty.

describe("users store", () => {
  let example: BootedExample | undefined;

  beforeAll(async () => {
    example = await bootExample();
  });

  afterAll(async () => {
    // A failed second boot leaves `example` undefined, so the stopped app is never stopped twice
    await example?.stop();
    example = undefined;
  });

  it("keeps the users of a boot between two requests", async () => {
    const booted = example;
    if (!booted) throw new Error("users.boot.test.ts: the app was not booted");

    const stored = await booted.store({ name: "Ada", email: "ada@example.com" });
    expect(stored.response.status).toBe(201);
    // The one UserService instance of this boot kept the user between two requests
    expect((await booted.requestJson("/api/users")).body).toEqual({ data: [stored.body] });
  });

  it("starts empty on a second boot in the same process", async () => {
    const current = example;
    if (!current) throw new Error("users.boot.test.ts: the app was not booted");
    await current.stop();
    example = undefined;

    example = await bootExample();
    const booted = example;

    // A new container builds a new singleton: nothing from the previous boot survives
    expect((await booted.requestJson("/api/users")).body).toEqual({ data: [] });
  });
});
