import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootExample, type BootedExample } from "./support/boot";

// E5 #343: the users slice over a real socket, the way a deployed app is reached. The server binds port 0 (the OS
// picks a free one), so it runs in CI beside another app, and the boot needs neither Google credentials nor MySQL.
// It covers the four statuses of the contract: 200 (index), 201 (store), 422 (validation) and 404 (show).

let example: BootedExample | undefined;
let server: ServerType | undefined;
let baseUrl: string;

beforeAll(async () => {
  const booted = await bootExample();
  example = booted;
  baseUrl = await new Promise((resolve, reject) => {
    const listening = serve({ fetch: booted.app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
      resolve(`http://127.0.0.1:${info.port}`);
    });
    server = listening;
    listening.once("error", reject);
  });
});

afterAll(async () => {
  const listening = server;
  if (listening) {
    await new Promise<void>((resolve, reject) => {
      listening.close((error) => (error ? reject(error) : resolve()));
      // Keep-alive sockets of fetch must not hold the close open
      listening.closeAllConnections();
    });
  }
  await example?.stop();
});

const postUser = (body: unknown) => fetch(`${baseUrl}/api/users`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("GET /api/users over a socket", () => {
  it("answers 200 with the list", async () => {
    const response = await fetch(`${baseUrl}/api/users`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: expect.any(Array) });
  });
});

describe("POST /api/users over a socket", () => {
  it("answers 201 with the stored user", async () => {
    const response = await postUser({ name: "Ada", email: "ada@example.com" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: expect.any(Number), name: "Ada", email: "ada@example.com" });
  });

  it("answers 422 with the catalog validation body for an invalid body", async () => {
    const response = await postUser({ name: "", email: "not-an-email" });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: "VALIDATION_ERROR",
      message: "The given data was invalid.",
      errors: { name: expect.any(Array), email: expect.any(Array) },
    });
  });
});

describe("GET /api/users/:id over a socket", () => {
  it("answers 404 with the catalog NOT_FOUND body for an unknown id", async () => {
    const response = await fetch(`${baseUrl}/api/users/999999`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "NOT_FOUND", message: "Not Found." });
  });
});
