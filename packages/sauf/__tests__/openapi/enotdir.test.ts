import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateOpenApiFile } from "../../src/openapi";
import { contractRuntime } from "./support";

/**
 * `realLocation` (load.ts) walks a path whose folders do not exist yet. On POSIX, `lstatSync` throws ENOTDIR when an
 * ancestor of the path is a file, while Windows returns `undefined`; this file forces the POSIX error on every OS so
 * the "below a path that is not a folder" guard is tested on both.
 *
 * `vi.spyOn` cannot patch a `node:fs` named export (the ESM namespace is not configurable), so the whole module is
 * automocked with pass-through spies (`{ spy: true }`) and only `lstatSync` is overridden for the nested path.
 */
vi.mock(import("node:fs"), { spy: true });

const fixture = fileURLToPath(new URL("../typegen/fixtures/project/app", import.meta.url));
// vitest's loader stands in for the app's Vite runner: its aliases resolve @laratype/contract and zod
const load = (url: string) => import(/* @vite-ignore */ url);

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "laratype-openapi-enotdir-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("realLocation with an ENOTDIR ancestor", () => {
  it("treats ENOTDIR as no entry, so --out below a file gets the folder guard's message", async () => {
    const dir = join(tmp, "project");
    mkdirSync(dir, { recursive: true });
    cpSync(fixture, join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "openapi-enotdir", version: "1.0.0" }));
    writeFileSync(join(dir, "file.json"), "{}");

    const spy = vi.mocked(lstatSync);
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    spy.mockImplementation(((path: unknown, options: unknown) => {
      // the exact shape Linux reports for the nested path below the file named file.json
      if (String(path).replace(/\\/g, "/").endsWith("file.json/nested.json")) {
        throw Object.assign(new Error(`ENOTDIR: not a directory, lstat '${String(path)}'`), { code: "ENOTDIR" });
      }
      return actual.lstatSync(path as never, options as never);
    }) as typeof lstatSync);
    try {
      await expect(
        generateOpenApiFile({ projectDir: dir, out: "file.json/nested.json", load, contract: contractRuntime }),
      ).rejects.toThrow('the output file "file.json/nested.json" (--out) is below a path that is not a folder');
      // the guard runs before the scan, so no generated folder was written
      expect(existsSync(join(dir, ".laratype"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  }, 60_000);
});
