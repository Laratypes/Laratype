import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// E2 #134: the v1 generators write the v1 app layout, and the generated files type-check in examples/basic. Runs the
// BUILT sauf (packages/sauf/dist), like devSsr.test.ts: run `bun run build` first.

const saufBin = fileURLToPath(new URL("../../dist/index.esm.js", import.meta.url));
const repo = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\\/g, "/");
const example = join(repo, "examples/basic");

interface Run {
  readonly code: number | null;
  readonly output: string;
}

let project: string;
let runs: Record<"contract" | "escape" | "types" | "command" | "controller" | "request" | "resource" | "nestedResource", Run>;

/** Runs `sauf <args>` in the project; resolves with the exit code and the output, without colors. */
const sauf = (...args: string[]) => new Promise<Run>((resolve) => {
  const child = spawn(process.execPath, [saufBin, ...args], {
    cwd: project,
    env: { ...process.env, NODE_ENV: "development", NO_COLOR: "1", FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  child.on("close", (code) => resolve({ code, output: output.replace(/\x1b\[[0-9;]*m/g, "") }));
});

const expectOk = (result: Run) => {
  expect(result.code, result.output).toBe(0);
};

beforeAll(async () => {
  if (!existsSync(saufBin)) throw new Error(`${saufBin} not found: run \`bun run build\` before this test.`);
  // Next to examples/basic, so the copied tsconfig's `extends: ../../tsconfig.json` and `rootDir` still resolve
  project = mkdtempSync(join(repo, "examples", ".make-"));
  for (const entry of ["app", "package.json", "tsconfig.json"]) {
    cpSync(join(example, entry), join(project, entry), { recursive: true });
  }
  // `$api` must point at the copy, not at examples/basic: the tsconfig's `paths` are relative to the repo root
  const tsconfig = join(project, "tsconfig.json");
  const source = readFileSync(tsconfig, "utf8");
  const api = join(project, ".laratype/api/index.gen.ts").replace(/\\/g, "/").slice(repo.length);
  const patched = source.replace(/"\$api": \[[^\]]*\]/, `"$api": ["${api}"]`);
  expect(patched).not.toBe(source);
  writeFileSync(tsconfig, patched);

  // Every generator once, so each test sees a complete run and a single `-t` filter still works
  runs = {
    contract: await sauf("make:contract", "reports/monthly"),
    escape: await sauf("make:contract", "../escape"),
    types: await sauf("types:generate", "--root", "app/api", "--base", "/api"),
    command: await sauf("make:command", "DraftCommand"),
    controller: await sauf("make:controller", "DraftController"),
    request: await sauf("make:request", "DraftRequest"),
    resource: await sauf("make:resource", "Draft", "--collection"),
    nestedResource: await sauf("make:resource", "admin/Note", "--collection"),
  };
}, 120_000);

afterAll(() => {
  if (project) rmSync(project, { recursive: true, force: true });
});

describe("v1 make generators", () => {
  it("make:contract writes into the contract folder tree", () => {
    expectOk(runs.contract);
    const file = join(project, "app/api/reports/monthly.ts");
    expect(existsSync(file), runs.contract.output).toBe(true);
    const stub = readFileSync(file, "utf8");
    expect(stub).toContain('import { defineContract, endpoint } from "@laratype/contract";');
    expect(stub).toContain('import type { Prefix } from "./$types";');
    expect(stub).toContain("export default defineContract<Prefix>()({");
    expect(stub).toContain('index: endpoint.get("/").query(IndexQuery)');
    expect(stub).toContain("z.coerce.number()");
  });

  it("make:contract rejects a path that leaves the contract tree", () => {
    expect(runs.escape.code, runs.escape.output).not.toBe(0);
    expect(runs.escape.output).toContain('Invalid contract name "../escape"');
    expect(existsSync(join(project, "app/escape.ts"))).toBe(false);
  });

  it("types:generate gives the nested folder its Prefix", () => {
    expectOk(runs.types);
    const types = join(project, ".laratype/types/app/api/reports/$types.d.ts");
    expect(existsSync(types), runs.types.output).toBe(true);
    expect(readFileSync(types, "utf8")).toContain("ContractPrefix<'/api/reports', []>");
  });

  it("the generated stubs type-check with examples/basic's tsconfig", () => {
    for (const [name, result] of Object.entries(runs)) {
      if (name === "escape") continue;
      expect(result.code, `${name}: ${result.output}`).toBe(0);
    }

    const generated = [
      "app/api/reports/monthly.ts",
      "app/console/commands/DraftCommand.ts",
      "app/http/controllers/DraftController.ts",
      "app/http/requests/DraftRequest.ts",
      "app/http/resources/DraftResource.ts",
      "app/http/resources/DraftResourceCollection.ts",
      // A sub-path is a folder, never part of an exported name
      "app/http/resources/admin/NoteResource.ts",
      "app/http/resources/admin/NoteResourceCollection.ts",
    ].map((path) => join(project, path));
    for (const file of generated) expect(existsSync(file), file).toBe(true);

    const { config } = ts.readConfigFile(join(project, "tsconfig.json"), ts.sys.readFile);
    const { options } = ts.parseJsonConfigFileContent(config, ts.sys, project);
    const program = ts.createProgram(
      [...generated, join(repo, "packages/global.d.ts"), join(repo, "packages/http/src/overload.d.ts")],
      { ...options, noEmit: true, composite: false, declaration: false, incremental: false },
    );
    const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) =>
      ts.formatDiagnostic(diagnostic, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => repo,
        getNewLine: () => "\n",
      }),
    );
    expect(diagnostics).toEqual([]);
  }, 120_000);
});
