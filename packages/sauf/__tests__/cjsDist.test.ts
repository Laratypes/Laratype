import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// Regression test for #329 (B25): the CJS build folded `import.meta.url` into
// file:///<build dir>/packages/sauf/src/..., so `resolveModule` resolved against a source path that only
// exists on the build machine. The built entry is copied next to a fake `vite` and required with a cwd
// outside the repo; the fake writes a marker, which proves the resolution base is the copied dist.
// `__PROD__` is set because that is the branch of resolveModule() that uses the URL (warmup.ts folds
// `process.env.NODE_ENV === "production"` to false at build time).

const entry = fileURLToPath(new URL("../dist/index.cjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const nodePath = path.join(repoRoot, "node_modules");

/** @type {string | undefined} */
let temp;

afterAll(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
});

/** A copy of the built entry under `<temp>/pkg/dist`, with a fake `vite` package beside it. */
const makeCopy = () => {
  temp = mkdtempSync(path.join(tmpdir(), "sauf-cjs-"));
  const pkg = path.join(temp, "pkg");
  mkdirSync(path.join(pkg, "dist"), { recursive: true });
  copyFileSync(entry, path.join(pkg, "dist", "index.cjs"));

  const vite = path.join(pkg, "node_modules", "vite");
  mkdirSync(vite, { recursive: true });
  writeFileSync(
    path.join(vite, "package.json"),
    `${JSON.stringify({ name: "vite", version: "0.0.0", type: "module", exports: { ".": "./index.js" } }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(vite, "index.js"),
    [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(process.env.SAUF_FAKE_VITE_MARKER, "resolved");',
      // The top-level await keeps `require("vite")` (DevRunner, after boot's import.meta.url import)
      // from loading this copy: only the URL-based import() reaches the marker.
      "await Promise.resolve();",
      'throw new Error("[b25] fake vite loaded");',
      "",
    ].join("\n"),
  );
  return pkg;
};

describe("sauf CJS dist", () => {
  it("keeps import.meta.url runtime instead of the build root", () => {
    const code = readFileSync(entry, "utf8");

    // The build root URL and its forward-slash path must not appear in the entry.
    expect(code).not.toContain(pathToFileURL(repoRoot).href.replace(/\/$/, ""));
    expect(code).toContain("pathToFileURL(__filename)");
  });

  it("resolves a module against the copied dist when run from another directory", () => {
    if (!existsSync(entry)) {
      throw new Error(`${entry} not found: run \`bun run build\` before this test.`);
    }
    const pkg = makeCopy();
    const probe = path.join(temp!, "probe.cjs");
    const marker = path.join(temp!, "vite-resolved.txt");

    // Start the entry the way `require("sauf")` does, with the argv check-dist uses for a bin dist.
    // The timer ends a run that got past the fake vite (a real one would be required) in 10s.
    writeFileSync(
      probe,
      [
        "globalThis.__PROD__ = true;",
        'process.argv = [process.execPath, "sauf", "--version"];',
        "setTimeout(() => process.exit(0), 10_000);",
        `require(${JSON.stringify(path.join(pkg, "dist", "index.cjs"))});`,
        "",
      ].join("\n"),
    );

    const child = spawnSync(process.execPath, [probe], {
      cwd: temp,
      env: { ...process.env, NODE_PATH: nodePath, SAUF_FAKE_VITE_MARKER: marker },
      encoding: "utf8",
      timeout: 30_000,
    });

    const output = `${child.stdout}\n${child.stderr}`;
    expect(existsSync(marker), `the copied dist did not resolve its own node_modules:\n${output}`).toBe(true);
    expect(readFileSync(marker, "utf8"), output).toBe("resolved");
  });
});
