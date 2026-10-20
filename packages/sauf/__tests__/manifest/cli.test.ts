import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// B1 #125: a manifest scan error (one model name in both layouts) fails only the commands that need the app, with the
// scan's message. `--help`, `types:generate` and `make:*` run and print it once as a warning. Runs the BUILT sauf
// (`packages/sauf/dist`), like devSsr.test.ts: run `bun run build` first.

const saufBin = fileURLToPath(new URL("../../dist/index.esm.js", import.meta.url));
const here = fileURLToPath(new URL(".", import.meta.url));
const MESSAGE = "[laratype:manifest] models/User is in both app/src/models/User.ts and app/models/User.ts: rename or remove one";

let project: string;

const write = (file: string, content = "export default class {};\n") => {
  mkdirSync(dirname(join(project, file)), { recursive: true });
  writeFileSync(join(project, file), content);
};

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

const count = (text: string, part: string) => text.split(part).length - 1;

beforeAll(() => {
  if (!existsSync(saufBin)) throw new Error(`${saufBin} not found: run \`bun run build\` before this test.`);
  // Inside the repo, so the project resolves the workspace packages
  project = mkdtempSync(join(here, ".cli-"));
  write("package.json", JSON.stringify({ name: "manifest-cli-fixture", version: "0.0.0", type: "module" }));
  write("app/config/config.ts", "export default { name: 'fixture' };\n");
  write("app/config/providers.ts", "export default [];\n");
  write("app/src/models/User.ts");
  write("app/models/User.ts");
  write("app/api/health.ts", "import { defineContract, endpoint } from '@laratype/contract'\nexport default defineContract()({ check: endpoint.get('/') })\n");
  // types:generate type-checks the tree: against the contract sources, so the test needs no `build:type`
  const repo = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\\/g, "/");
  write("tsconfig.json", JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, noEmit: true, types: [],
      lib: ["ES2022", "DOM"], rootDirs: [".", ".laratype/types"], paths: { "@laratype/contract": [`${repo}packages/contract/src/index.ts`] },
    },
    include: ["app/api", ".laratype"],
  }));
});

afterAll(() => {
  if (project) rmSync(project, { recursive: true, force: true });
});

describe("sauf with a manifest scan error", () => {
  it("--help, types:generate and make:* run and warn once", async () => {
    const [help, types, make] = await Promise.all([
      sauf("--help"),
      sauf("types:generate"),
      sauf("make:controller", "HealthController"),
    ]);
    expect(help.code).toBe(0);
    expect(help.output).toContain("types:generate");
    expect(count(help.output, MESSAGE)).toBe(1);

    expect(types.code, types.output).toBe(0);
    expect(count(types.output, MESSAGE)).toBe(1);
    expect(existsSync(join(project, ".laratype/api/index.gen.ts"))).toBe(true);

    expect(make.code, make.output).toBe(0);
    expect(count(make.output, MESSAGE)).toBe(1);
  }, 120_000);

  it("route:list, db:seed and build fail with the scan's message", async () => {
    const results = await Promise.all([sauf("route:list"), sauf("db:seed"), sauf("build")]);
    for (const { code, output } of results) {
      expect(code, output).not.toBe(0);
      expect(output).toContain(`Error: ${MESSAGE}`);
    }
  }, 120_000);
});
