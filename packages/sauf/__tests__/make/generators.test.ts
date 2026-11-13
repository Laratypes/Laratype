import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// E2 #134: the v1 generators write the v1 app layout, and the generated files type-check in examples/basic. The kept
// 0.5 generators (gate, middleware, model, policy) are covered by their name checks here too. Runs the BUILT sauf
// (packages/sauf/dist), like devSsr.test.ts: run `bun run build` first.

const saufBin = fileURLToPath(new URL("../../dist/index.esm.js", import.meta.url));
const repo = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\\/g, "/");
const example = join(repo, "examples/basic");

interface Run {
  readonly code: number | null;
  readonly output: string;
}

type RunName =
  | "contract"
  | "contractHyphen"
  | "nestedIndex"
  | "escape"
  | "contractIndex"
  | "contractIndexUpper"
  | "paramIndex"
  | "types"
  | "command"
  | "controller"
  | "hyphenFolder"
  | "request"
  | "resource"
  | "nestedResource"
  | "escapeController"
  | "escapeRequest"
  | "escapeResource"
  | "escapeGate"
  | "escapeMiddleware"
  | "escapeModel"
  | "escapePolicy"
  | "identifierController"
  | "identifierRequest"
  | "identifierResource"
  | "identifierMiddleware"
  | "identifierModel"
  | "identifierPolicy"
  | "identifierGate"
  | "reservedController"
  | "policyModel"
  | "policyModelOk";

/** The runs that are expected to fail, so the type-check test does not demand their files. */
const failingRuns = new Set<RunName>([
  "escape",
  "contractIndex",
  "contractIndexUpper",
  "paramIndex",
  "escapeController",
  "escapeRequest",
  "escapeResource",
  "escapeGate",
  "escapeMiddleware",
  "escapeModel",
  "escapePolicy",
  "identifierController",
  "identifierRequest",
  "identifierResource",
  "identifierMiddleware",
  "identifierModel",
  "identifierPolicy",
  "identifierGate",
  "reservedController",
  "policyModel",
]);

let project: string;
let runs: Record<RunName, Run>;

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
    contractHyphen: await sauf("make:contract", "my-note"),
    nestedIndex: await sauf("make:contract", "reports/index"),
    escape: await sauf("make:contract", "../escape"),
    contractIndex: await sauf("make:contract", "index"),
    contractIndexUpper: await sauf("make:contract", "INDEX.TS"),
    paramIndex: await sauf("make:contract", "[id]/index"),
    types: await sauf("types:generate", "--root", "app/api", "--base", "/api"),
    command: await sauf("make:command", "DraftCommand"),
    controller: await sauf("make:controller", "DraftController"),
    hyphenFolder: await sauf("make:controller", "my-team/PostController"),
    request: await sauf("make:request", "DraftRequest"),
    resource: await sauf("make:resource", "Draft", "--collection"),
    nestedResource: await sauf("make:resource", "admin/Note", "--collection"),
    escapeController: await sauf("make:controller", "../x"),
    escapeRequest: await sauf("make:request", "../x"),
    escapeResource: await sauf("make:resource", "../x", "--collection"),
    escapeGate: await sauf("make:gate", "../x"),
    escapeMiddleware: await sauf("make:middleware", "../x"),
    escapeModel: await sauf("make:model", "../x"),
    escapePolicy: await sauf("make:policy", "../x"),
    identifierController: await sauf("make:controller", "my-note"),
    identifierRequest: await sauf("make:request", "my-note"),
    identifierResource: await sauf("make:resource", "my-note", "--collection"),
    identifierMiddleware: await sauf("make:middleware", "my-note"),
    identifierModel: await sauf("make:model", "my-note"),
    identifierPolicy: await sauf("make:policy", "my-note"),
    identifierGate: await sauf("make:gate", "my-note"),
    // A reserved word is not an identifier: `class` would write `export default class class`
    reservedController: await sauf("make:controller", "class"),
    // `-m` takes the model generator's rules; the policy name is valid, so only the model name is refused
    policyModel: await sauf("make:policy", "DraftPolicy", "-m", "my-note"),
    policyModelOk: await sauf("make:policy", "PostPolicy", "-m", "Post"),
  };
}, 240_000);

afterAll(() => {
  if (project) rmSync(project, { recursive: true, force: true });
});

describe("make generators", () => {
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

  it("make:contract keeps its folder rules for a dashed file name", () => {
    expectOk(runs.contractHyphen);
    expect(existsSync(join(project, "app/api/my-note.ts")), runs.contractHyphen.output).toBe(true);
  });

  it("make:contract keeps a nested index, which names its folder (docs/v1/contract.md › Contract folder tree)", () => {
    expectOk(runs.nestedIndex);
    expect(existsSync(join(project, "app/api/reports/index.ts")), runs.nestedIndex.output).toBe(true);
  });

  it("make:contract rejects a path that leaves the contract tree", () => {
    expect(runs.escape.code, runs.escape.output).not.toBe(0);
    expect(runs.escape.output).toContain('Invalid contract name "../escape"');
    expect(existsSync(join(project, "app/escape.ts"))).toBe(false);
  });

  it("make:contract rejects an index with no named folder, which the next scan would fail", () => {
    const message = (name: string) => [
      `Invalid contract name "${name}": an index needs a named folder under app/api.`,
      "Fix: name the file after its contract (users.ts), or use a named folder (users/index.ts).",
    ].join(" ");
    for (const [run, name] of [
      [runs.contractIndex, "index"],
      [runs.contractIndexUpper, "INDEX"],
      [runs.paramIndex, "[id]/index"],
    ] as const) {
      expect(run.code, run.output).not.toBe(0);
      expect(run.output).toContain(message(name));
    }
    expect(existsSync(join(project, "app/api/index.ts"))).toBe(false);
    expect(existsSync(join(project, "app/api/INDEX.ts"))).toBe(false);
    expect(existsSync(join(project, "app/api/[id]/index.ts"))).toBe(false);
  });

  it("make:controller, make:request and make:resource reject a path that leaves their folder", () => {
    const escapes = [
      {
        run: runs.escapeController,
        message:
          'Invalid controller name "../x": use letters, digits, "_" and "-", in folders under app/http/controllers.',
      },
      {
        run: runs.escapeRequest,
        message:
          'Invalid request name "../x": use letters, digits, "_" and "-", in folders under app/http/requests.',
      },
      {
        run: runs.escapeResource,
        message:
          'Invalid resource name "../x": use letters, digits, "_" and "-", in folders under app/http/resources.',
      },
    ];
    for (const { run, message } of escapes) {
      expect(run.code, run.output).not.toBe(0);
      expect(run.output).toContain(message);
    }
    // No file of the rejected name, and none outside app/http, is written
    const files = [
      "app/http/x.ts",
      "app/http/xResource.ts",
      "app/http/xResourceCollection.ts",
      "app/x.ts",
      "x.ts",
    ];
    for (const file of files) expect(existsSync(join(project, file)), file).toBe(false);
  });

  it("make:gate, make:middleware, make:model and make:policy reject a path that leaves their folder", () => {
    const escapes = [
      {
        run: runs.escapeGate,
        message: 'Invalid gate name "../x": use letters, digits, "_" and "-", in folders under src/gates.',
      },
      {
        run: runs.escapeMiddleware,
        message:
          'Invalid middleware name "../x": use letters, digits, "_" and "-", in folders under src/http/middleware.',
      },
      {
        run: runs.escapeModel,
        message: 'Invalid model name "../x": use letters, digits, "_" and "-", in folders under src/models.',
      },
      {
        run: runs.escapePolicy,
        message: 'Invalid policy name "../x": use letters, digits, "_" and "-", in folders under src/policies.',
      },
    ];
    for (const { run, message } of escapes) {
      expect(run.code, run.output).not.toBe(0);
      expect(run.output).toContain(message);
    }
    // `../x` from each folder, its destination folder, the project root and the folder outside the project
    const files = [
      "src/x.ts",
      "src/http/x.ts",
      "src/gates/x.ts",
      "src/http/middleware/x.ts",
      "src/models/x.ts",
      "src/policies/x.ts",
      "x.ts",
    ];
    for (const file of files) expect(existsSync(join(project, file)), file).toBe(false);
    expect(existsSync(join(project, "..", "x.ts"))).toBe(false);
  });

  it("every generator that names a class or function after the file rejects a non-identifier name", () => {
    const message = (generator: string, folder: string) => [
      `Invalid ${generator} name "my-note": the last segment names the exported class or function,`,
      'so use a valid identifier (letters, digits and "_", not starting with a digit),',
      `under ${folder}.`,
    ].join(" ");
    const cases = [
      { run: runs.identifierController, message: message("controller", "app/http/controllers") },
      { run: runs.identifierRequest, message: message("request", "app/http/requests") },
      { run: runs.identifierResource, message: message("resource", "app/http/resources") },
      { run: runs.identifierMiddleware, message: message("middleware", "src/http/middleware") },
      { run: runs.identifierModel, message: message("model", "src/models") },
      { run: runs.identifierPolicy, message: message("policy", "src/policies") },
      { run: runs.identifierGate, message: message("gate", "src/gates") },
    ];
    for (const { run, message } of cases) {
      expect(run.code, run.output).not.toBe(0);
      expect(run.output).toContain(message);
    }
    // The folder may keep `-`; only the file name is the identifier
    expect(existsSync(join(project, "app/http/controllers/my-team/PostController.ts")), runs.hyphenFolder.output)
      .toBe(true);
    const files = [
      "app/http/controllers/my-note.ts",
      "app/http/requests/my-note.ts",
      "app/http/resources/my-noteResource.ts",
      "app/http/resources/my-noteResourceCollection.ts",
      "src/http/middleware/my-note.ts",
      "src/models/my-note.ts",
      "src/policies/my-note.ts",
      "src/gates/my-note.ts",
    ];
    for (const file of files) expect(existsSync(join(project, file)), file).toBe(false);
  });

  it("make:controller rejects a reserved word, which cannot name a class", () => {
    // A reserved word matches the identifier pattern but `export default class class` does not compile
    const message = [
      'Invalid controller name "class": the last segment names the exported class or function,',
      'so use a valid identifier (letters, digits and "_", not starting with a digit),',
      "under app/http/controllers.",
    ].join(" ");
    expect(runs.reservedController.code, runs.reservedController.output).not.toBe(0);
    expect(runs.reservedController.output).toContain(message);
    expect(existsSync(join(project, "app/http/controllers/class.ts"))).toBe(false);
  });

  it("make:policy checks its -m model name with the make:model rules", async () => {
    expect(runs.policyModel.code, runs.policyModel.output).not.toBe(0);
    expect(runs.policyModel.output).toContain([
      'Invalid model name "my-note": the last segment names the exported class or function,',
      'so use a valid identifier (letters, digits and "_", not starting with a digit),',
      "under src/models.",
    ].join(" "));
    expect(existsSync(join(project, "src/policies/DraftPolicy.ts"))).toBe(false);

    // The last segment used to come from `../x` silently: the model rules refuse it before the stub is written
    const escape = await sauf("make:policy", "EscapedPolicy", "-m", "../x");
    expect(escape.code, escape.output).not.toBe(0);
    expect(escape.output).toContain(
      'Invalid model name "../x": use letters, digits, "_" and "-", in folders under src/models.',
    );
    expect(existsSync(join(project, "src/policies/EscapedPolicy.ts"))).toBe(false);
  }, 120_000);

  it("make:policy -m writes the model import and the camelCase parameter", () => {
    expectOk(runs.policyModelOk);
    const stub = readFileSync(join(project, "src/policies/PostPolicy.ts"), "utf8");
    expect(stub).toContain('import Post from "../models/Post";');
    expect(stub).toContain("viewAny(actor: User, post: Post)");
  });

  it("types:generate gives the nested folder its Prefix", () => {
    expectOk(runs.types);
    const types = join(project, ".laratype/types/app/api/reports/$types.d.ts");
    expect(existsSync(types), runs.types.output).toBe(true);
    expect(readFileSync(types, "utf8")).toContain("ContractPrefix<'/api/reports', []>");
  });

  it("the generated stubs type-check with examples/basic's tsconfig", () => {
    for (const name of Object.keys(runs) as RunName[]) {
      if (failingRuns.has(name)) continue;
      const result = runs[name];
      expect(result.code, `${name}: ${result.output}`).toBe(0);
    }

    const generated = [
      "app/api/my-note.ts",
      "app/api/reports/monthly.ts",
      "app/api/reports/index.ts",
      "app/console/commands/DraftCommand.ts",
      "app/http/controllers/DraftController.ts",
      "app/http/controllers/my-team/PostController.ts",
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
