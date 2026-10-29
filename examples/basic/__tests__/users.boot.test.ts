import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootExample, type BootedExample } from "./support/boot";

// E1 #344: the users store belongs to the UserService singleton of the app container (docs/v1/di.md › Decorators:
// @Inject and @Injectable), not to module state, so a second boot in the same process starts empty.

const json = async (example: BootedExample, path: string, init?: RequestInit) => {
  const response = await example.app.request(path, init);
  return { response, body: await response.json() };
};

const store = (example: BootedExample, body: unknown) => json(example, "/api/users", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("users store", () => {
  let example: BootedExample;

  beforeAll(async () => {
    example = await bootExample();
  });

  afterAll(async () => {
    await example.stop();
  });

  it("keeps the users of a boot and starts empty on a second boot in the same process", async () => {
    const stored = await store(example, { name: "Ada", email: "ada@example.com" });
    expect(stored.response.status).toBe(201);
    // The one UserService instance of this boot kept the user between two requests
    expect((await json(example, "/api/users")).body).toEqual({ data: [stored.body] });

    await example.stop();
    example = await bootExample();

    // A new container builds a new singleton: nothing from the previous boot survives
    expect((await json(example, "/api/users")).body).toEqual({ data: [] });
  });
});
