import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Regression test for #187 (B12): runs the BUILT sauf (`packages/sauf/dist`) `dev`
// command on a fixture app. The fixture's vite.config.mjs records the workspace
// module ids Vite SSR loads, and its ProbeServiceProvider prints them together with
// whether a subclass of @laratype/http's Middleware can be constructed.
//
// Before #188 (B13), the dists folded `globalThis.__PROD__` to true, so the
// dist -> src rewrite in sauf's dev plugin was dead code and @laratype/http resolved
// to a dist whose Middleware export was undefined:
// "TypeError: The superclass is not a constructor".

const saufBin = fileURLToPath(new URL("../dist/index.esm.js", import.meta.url));
const fixtureDir = fileURLToPath(new URL("./fixtures/ssr-app", import.meta.url));

const PROBE_PREFIX = "[ssr-probe] ";
const BOOT_TIMEOUT = 60_000;

type Probe = { constructible: boolean, loaded: string[] };

const getFreePort = () => new Promise<number>((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, () => {
    const { port } = server.address() as { port: number };
    server.close(() => resolve(port));
  });
});

describe("sauf dev (built dist) SSR-loads workspace packages from src", () => {
  let child: ChildProcess | undefined;
  let output = "";
  let port = 0;
  let ready = false;

  beforeAll(async () => {
    if (!existsSync(saufBin)) {
      throw new Error(`${saufBin} not found: run \`bun run build\` before this test.`);
    }
    port = await getFreePort();

    child = spawn("bun", [saufBin, "dev", "--port", String(port)], {
      cwd: fixtureDir,
      env: { ...process.env, NODE_ENV: "development", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);

    let exited = false;
    child.once("exit", () => {
      exited = true;
    });

    // The banner is hidden when the logger detects a test environment, so wait for
    // the server to answer instead.
    const deadline = Date.now() + BOOT_TIMEOUT;
    while (!exited && Date.now() < deadline) {
      try {
        await fetch(`http://localhost:${port}/`);
        ready = true;
        break;
      }
      catch {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }, BOOT_TIMEOUT + 5_000);

  afterAll(() => {
    child?.kill();
  });

  const readProbe = (): Probe | undefined => {
    const line = output.split(/\r?\n/).find(line => line.startsWith(PROBE_PREFIX));
    return line ? JSON.parse(line.slice(PROBE_PREFIX.length)) : undefined;
  };

  it("boots without a superclass error", () => {
    expect(output).not.toContain("superclass is not a constructor");
    expect(readProbe(), output).toBeDefined();
  });

  it("constructs a subclass of @laratype/http Middleware", () => {
    expect(readProbe()?.constructible, output).toBe(true);
  });

  it("rewrites @laratype/* from dist to src", () => {
    const loaded = readProbe()?.loaded ?? [];

    expect(loaded).toContain("packages/http/src/index.ts");
    expect(loaded.filter(id => id.includes("/dist/"))).toEqual([]);
  });

  it("serves requests", async () => {
    expect(ready, output).toBe(true);

    const response = await fetch(`http://localhost:${port}/`);

    expect(response.status).toBeLessThan(500);
  });
});
