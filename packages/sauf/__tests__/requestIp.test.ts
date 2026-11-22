// H30 #299: the node entry registers @hono/node-server's getConnInfo, so request.ip() reads the socket of the server
// that accepted the request; a dual-stack listener reports an IPv4 client as an IPv4-mapped IPv6 address.
import "reflect-metadata";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { Console } from "@laratype/console";
import { Container, depsRegistry } from "@laratype/core";
import { HTTP_APP } from "@laratype/support";
import { Controller, Request as LaratypeRequest, RequestKernel, ResponseKernel } from "@laratype/http";
import { mountNodeConnInfo } from "../src/adapters/node/connInfo";

/** The module @laratype/http is loaded as: the real one, through the transpiler in a test as in `sauf dev`. */
const loadHttp = async () => await import("@laratype/http");

/** The per-process flags mountNodeConnInfo's warnings set; cleared so each test can see its first print. */
const MISSING_HTTP_WARNED = Symbol.for("laratype.sauf.missingHttpWarned");
const NO_MOUNT_CONN_INFO_WARNED = Symbol.for("laratype.sauf.noMountConnInfoWarned");
const resetConnInfoWarnings = () => {
  const store = globalThis as { [key: symbol]: true | undefined };
  delete store[MISSING_HTTP_WARNED];
  delete store[NO_MOUNT_CONN_INFO_WARNED];
};

/** A `node_modules/@laratype/http` package in `directory` whose entry exports no `mountConnInfo` (an older copy). */
const writeHttpPackageWithoutMountConnInfo = (directory: string) => {
  const packageDir = join(directory, "node_modules", "@laratype", "http");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({
    name: "@laratype/http", version: "0.0.0", type: "module", main: "index.js", exports: { ".": "./index.js" },
  }));
  writeFileSync(join(packageDir, "index.js"), "export const value = 1;\n");
};

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

  it("registers nothing and warns once when @laratype/http loads without mountConnInfo", async () => {
    resetConnInfoWarnings();
    const warn = vi.spyOn(Console, "warn").mockImplementation(() => {});
    try {
      // support's importModule returns undefined after logging a failed import; an older copy loads without the seam
      for (const http of [undefined, {}, { mountConnInfo: 42 }]) {
        await expect(mountNodeConnInfo(new Hono(), async () => http)).resolves.toBeUndefined();
      }
      expect(warn).toHaveBeenCalledTimes(1);
      const text = String(warn.mock.calls[0]![0]);
      expect(text).toContain("If this app serves routes with @laratype/http");
      expect(text).toContain("@laratype/http loaded without mountConnInfo");
      expect(text).toContain("request.ip()");
      expect(text).toContain(".throttle()");
    } finally {
      warn.mockRestore();
    }
  });

  it("skips only the exact missing @laratype/http resolution error, warning once", async () => {
    resetConnInfoWarnings();
    const warn = vi.spyOn(Console, "warn").mockImplementation(() => {});
    try {
      // support's importModule resolves before its try: mlly's and Node's forms name the unresolved specifier
      const missing = [
        Object.assign(new Error("Cannot find module @laratype/http imported from file:///app/dist/app.manifest.js"), {
          code: "ERR_MODULE_NOT_FOUND",
        }),
        Object.assign(new Error("Cannot find package '@laratype/http' imported from file:///app/dist/app.manifest.js"), {
          code: "ERR_MODULE_NOT_FOUND",
        }),
      ];
      for (const error of missing) {
        await expect(mountNodeConnInfo(new Hono(), async () => { throw error; })).resolves.toBeUndefined();
      }
      expect(warn).toHaveBeenCalledTimes(1);
      const text = String(warn.mock.calls[0]![0]);
      expect(text).toContain("If this app serves routes with @laratype/http");
      expect(text).toContain("@laratype/http does not resolve from the working directory");
      expect(text).toContain(process.cwd());
      expect(text).toContain("request.ip()");
      expect(text).toContain(".throttle()");
      expect(text).toContain("Install @laratype/http");
      expect(text).toContain("project root");
    } finally {
      warn.mockRestore();
    }
  });

  it("rethrows a missing dependency inside @laratype/http, and a look-alike package", async () => {
    resetConnInfoWarnings();
    const warn = vi.spyOn(Console, "warn").mockImplementation(() => {});
    try {
      const failures = [
        // Node and mlly forms: the importer is the installed @laratype/http, so the app's install is broken
        Object.assign(new Error("Cannot find package 'es-toolkit' imported from /app/node_modules/@laratype/http/dist/index.esm.js"), {
          code: "ERR_MODULE_NOT_FOUND",
        }),
        Object.assign(new Error("Cannot find module es-toolkit imported from /app/node_modules/@laratype/http/dist/index.esm.js"), {
          code: "ERR_MODULE_NOT_FOUND",
        }),
        // The specifier is not exactly @laratype/http
        Object.assign(new Error("Cannot find module @laratype/httpx imported from file:///app/dist/app.manifest.js"), {
          code: "ERR_MODULE_NOT_FOUND",
        }),
        Object.assign(new Error("Cannot find package '@laratype/httpx' imported from file:///app/dist/app.manifest.js"), {
          code: "ERR_MODULE_NOT_FOUND",
        }),
      ];
      for (const failure of failures) {
        await expect(mountNodeConnInfo(new Hono(), async () => { throw failure; }), failure.message).rejects.toBe(failure);
      }
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("skips and warns once with the real importModule where @laratype/http does not resolve", async () => {
    resetConnInfoWarnings();
    const warn = vi.spyOn(Console, "warn").mockImplementation(() => {});
    const directory = mkdtempSync(join(tmpdir(), "laratype-sauf-no-http-"));
    const cwd = process.cwd();
    try {
      // resolveSync without a url resolves from the working directory, where there is no node_modules/@laratype/http
      process.chdir(directory);
      await expect(mountNodeConnInfo(new Hono())).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      const text = String(warn.mock.calls[0]![0]);
      expect(text).toContain("@laratype/http does not resolve from the working directory");
      expect(text).toContain(process.cwd());
    } finally {
      process.chdir(cwd);
      rmSync(directory, { recursive: true, force: true });
      warn.mockRestore();
    }
  });

  it("warns once with the real importModule when the installed @laratype/http has no mountConnInfo", async () => {
    resetConnInfoWarnings();
    const warn = vi.spyOn(Console, "warn").mockImplementation(() => {});
    const directory = mkdtempSync(join(tmpdir(), "laratype-sauf-old-http-"));
    const cwd = process.cwd();
    // `sauf dev` gives importModule a Vite ssrLoadModule; here dynamic import stands in, so the temp package loads
    const previousLoader = globalThis.__sauf_transpiler_instance;
    globalThis.__sauf_transpiler_instance = async (id: string) => await import(id);
    try {
      writeHttpPackageWithoutMountConnInfo(directory);
      process.chdir(directory);
      await expect(mountNodeConnInfo(new Hono())).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      const text = String(warn.mock.calls[0]![0]);
      expect(text).toContain("@laratype/http loaded without mountConnInfo");
      expect(text).toContain("request.ip()");
      expect(text).toContain(".throttle()");
    } finally {
      globalThis.__sauf_transpiler_instance = previousLoader;
      process.chdir(cwd);
      rmSync(directory, { recursive: true, force: true });
      warn.mockRestore();
    }
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
