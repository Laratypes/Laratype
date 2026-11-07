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

let project: string;

/** Runs `sauf <args>` in the project; resolves with the exit code and the output, without colors. */
const sauf = (...args: string[]) => new Promise<{ code: number | null; output: string }>((resolve) => {
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

const expectOk = (result: { code: number | null; output: string }) => {
  expect(result.code, result.output).toBe(0);
};

beforeAll(() => {
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
});

afterAll(() => {
  if (project) rmSync(project, { recursive: true, force: true });
});

describe("v1 make generators", () => {
  it("make:contract writes into the contract folder tree", async () => {
    const result = await sauf("make:contract", "reports/monthly");
    expectOk(result);
    const file = join(project, "app/api/reports/monthly.ts");
    expect(existsSync(file), result.output).toBe(true);
    const stub = readFileSync(file, "utf8");
    expect(stub).toContain('import { defineContract, endpoint } from "@laratype/contract";');
    expect(stub).toContain('import type { Prefix } from "./$types";');
    expect(stub).toContain("export default defineContract<Prefix>()({");
    expect(stub).toContain('index: endpoint.get("/").query(IndexQuery)');
    expect(stub).toContain("z.coerce.number()");
  }, 120_000);

  it("types:generate gives the nested folder its Prefix", async () => {
    const result = await sauf("types:generate", "--root", "app/api", "--base", "/api");
    expectOk(result);
    const types = join(project, ".laratype/types/app/api/reports/$types.d.ts");
    expect(existsSync(types), result.output).toBe(true);
    expect(readFileSync(types, "utf8")).toContain("ContractPrefix<'/api/reports', []>");
  }, 120_000);

  it("the generated stubs type-check with examples/basic's tsconfig", async () => {
    expectOk(await sauf("make:command", "DraftCommand"));
    expectOk(await sauf("make:controller", "DraftController"));
    expectOk(await sauf("make:request", "DraftRequest"));
    expectOk(await sauf("make:resource", "Draft", "--collection"));

    const generated = [
      "app/api/reports/monthly.ts",
      "app/console/commands/DraftCommand.ts",
      "app/http/controllers/DraftController.ts",
      "app/http/requests/DraftRequest.ts",
      "app/http/resources/DraftResource.ts",
      "app/http/resources/DraftResourceCollection.ts",
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
