// H30 #299: the node entry registers @hono/node-server's getConnInfo, so request.ip() reads the socket of the server
// that accepted the request; a dual-stack listener reports an IPv4 client as an IPv4-mapped IPv6 address.
import "reflect-metadata";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { Container, depsRegistry } from "@laratype/core";
import { HTTP_APP } from "@laratype/support";
import { Controller, Request as LaratypeRequest, RequestKernel, ResponseKernel } from "@laratype/http";
import { mountNodeConnInfo } from "../src/adapters/node/connInfo";

/** The module @laratype/http is loaded as: the real one, through the transpiler in a test as in `sauf dev`. */
const loadHttp = async () => await import("@laratype/http");

class WhoAmI extends Controller {
  index(request: LaratypeRequest) {
    return { ip: request.ip() ?? null };
  }
}

/** An app booted like the node entry: the getter is mounted before the providers add the routes. */
const bootApp = async () => {
  const container = new Container({ deps: depsRegistry });
  const app = new Hono();
  await mountNodeConnInfo(app, loadHttp);
  container.instance(HTTP_APP, app);
  new RequestKernel(container).boot();
  new ResponseKernel(container).boot();
  app.get("/whoami", RequestKernel.handle({ method: "get", path: "/whoami", controller: [WhoAmI, "index"] }));
  return app;
};

/** A server on `hostname`, or undefined when this environment cannot listen there. */
const listen = async (app: Hono, hostname: string): Promise<ServerType | undefined> => {
  try {
    return await new Promise<ServerType>((resolve, reject) => {
      const server = serve({ fetch: app.fetch, hostname, port: 0 }, () => resolve(server));
      server.on("error", reject);
    });
  } catch {
    return undefined;
  }
};

const close = (server: ServerType) => new Promise<void>((resolve) => server.close(() => resolve()));

describe("request.ip() on the node adapter", () => {
  let server: ServerType | undefined;
  let origin = "";

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    server = await listen(await bootApp(), "127.0.0.1");
    if (server) origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (server) await close(server);
  });

  it("returns the socket address, never an X-Forwarded-For header", async () => {
    expect(server).toBeDefined();
    const response = await fetch(`${origin}/whoami`, { headers: { "X-Forwarded-For": "203.0.113.7", "X-Real-IP": "203.0.113.8" } });
    expect(await response.json()).toEqual({ ip: "127.0.0.1" });
  });

  it("normalizes the IPv4-mapped address a dual-stack listener reports", async () => {
    // An environment without an IPv6 stack cannot bind `::`; the http unit tests cover the normalization there
    const dual = await listen(await bootApp(), "::");
    if (!dual) return;
    try {
      const url = `http://127.0.0.1:${(dual.address() as AddressInfo).port}/whoami`;
      expect(await (await fetch(url)).json()).toEqual({ ip: "127.0.0.1" });
    } finally {
      await close(dual);
    }
  });
});

describe("mountNodeConnInfo", () => {
  it("loads @laratype/http on demand and hands it the runtime's getConnInfo", async () => {
    const http = await import("@laratype/http");
    const mountConnInfo = vi.fn(http.mountConnInfo);
    const load = vi.fn(async () => ({ mountConnInfo }));
    await mountNodeConnInfo(new Hono(), load);
    expect(load).toHaveBeenCalledWith("@laratype/http", { internal: true });
    expect(mountConnInfo).toHaveBeenCalledTimes(1);
    expect(mountConnInfo.mock.calls[0]![1]).toBeTypeOf("function");
  });

  it("registers nothing when @laratype/http is missing or has no mountConnInfo", async () => {
    await expect(mountNodeConnInfo(new Hono(), async () => undefined)).resolves.toBeUndefined();
    await expect(mountNodeConnInfo(new Hono(), async () => ({}))).resolves.toBeUndefined();
    await expect(mountNodeConnInfo(new Hono(), async () => ({ mountConnInfo: 42 }))).resolves.toBeUndefined();
  });

  it("registers nothing when the loader cannot resolve the optional @laratype/http", async () => {
    // support's importModule resolves before its try, so a missing package rejects with the resolver's error
    const missing = Object.assign(new Error("Cannot find module @laratype/http imported from file:///app/dist/app.manifest.js"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    await expect(mountNodeConnInfo(new Hono(), async () => { throw missing; })).resolves.toBeUndefined();
  });

  it("keeps every other loader failure visible", async () => {
    const failures: unknown[] = [
      new Error("the transpiler failed"),
      Object.assign(new Error("Cannot find module @laratype/support imported from file:///app/dist/app.manifest.js"), {
        code: "ERR_MODULE_NOT_FOUND",
      }),
      Object.assign(new Error("no code on this one"), { code: 42 }),
      { code: "ERR_MODULE_NOT_FOUND" },
      "boom",
      null,
      undefined,
    ];
    for (const failure of failures) {
      await expect(mountNodeConnInfo(new Hono(), async () => { throw failure; }), String(failure)).rejects.toBe(failure);
    }
  });

  it("lets @laratype/http refuse a value that is not a Hono app", async () => {
    await expect(mountNodeConnInfo(null, loadHttp)).rejects.toThrow(TypeError);
    await expect(mountNodeConnInfo(42, loadHttp)).rejects.toThrow(TypeError);
  });
});
