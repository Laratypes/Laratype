import { cpSync, existsSync, lstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateOpenApiFile } from "../../src/openapi";
import { contractRuntime } from "./support";

/**
 * `realLocation` and `checkOutputFolder` (load.ts) walk a path whose folders do not exist yet. On POSIX, `lstatSync`
 * throws ENOTDIR when a segment of the path is below a file, while Windows returns `undefined`; this file forces the
 * POSIX error on every OS so the "below a path that is not a folder" guard is tested on both.
 *
 * `vi.spyOn` cannot patch a `node:fs` named export (the ESM namespace is not configurable), so the whole module is
 * automocked with pass-through spies (`{ spy: true }`) and only `lstatSync` is overridden for every path below the
 * file. `enotdirPaths` records the calls the override answered, so a run that never exercised the branch (for
 * example on Windows without the override) fails the test instead of passing on the platform's own error.
 */
vi.mock(import("node:fs"), { spy: true });

const fixture = fileURLToPath(new URL("../typegen/fixtures/project/app", import.meta.url));
// vitest's loader stands in for the app's Vite runner: its aliases resolve @laratype/contract and zod
const load = (url: string) => import(/* @vite-ignore */ url);

const enotdirPaths: string[] = [];
/** Any path below the file named `file.json` (the separator differs per platform). */
const underFile = (path: string): boolean => /[\\/]file\.json[\\/]/.test(path);

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "laratype-openapi-enotdir-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("an ENOTDIR segment below an --out ancestor", () => {
  it.each(["file.json/nested.json", "file.json/sub/nested.json"])(
    "treats ENOTDIR as no entry for %s, so the folder guard's message answers",
    async (out) => {
      const dir = mkdtempSync(join(tmp, "project-"));
      cpSync(fixture, join(dir, "app"), { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "openapi-enotdir", version: "1.0.0" }));
      writeFileSync(join(dir, "file.json"), "{}");

      enotdirPaths.length = 0;
      const spy = vi.mocked(lstatSync);
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      spy.mockImplementation(((path: unknown, options: unknown) => {
        const text = String(path);
        if (underFile(text)) {
          enotdirPaths.push(text);
          throw Object.assign(new Error(`ENOTDIR: not a directory, lstat '${text}'`), { code: "ENOTDIR" });
        }
        return actual.lstatSync(path as never, options as never);
      }) as typeof lstatSync);
      try {
        await expect(
          generateOpenApiFile({ projectDir: dir, out, load, contract: contractRuntime }),
        ).rejects.toThrow(`the output file "${out}" (--out) is below a path that is not a folder`);
        // the override answered at least one path below the file, and only such paths: the branch ran on every OS
        expect(enotdirPaths.length, `${out}: the ENOTDIR override was not exercised`).toBeGreaterThan(0);
        expect(enotdirPaths.every(underFile)).toBe(true);
        expect(enotdirPaths.some((path) => path.replace(/\\/g, "/").endsWith(`/${out}`))).toBe(true);
        // the guard runs before the scan, so no generated folder was written
        expect(existsSync(join(dir, ".laratype"))).toBe(false);
      } finally {
        spy.mockRestore();
      }
    },
    60_000,
  );
});
