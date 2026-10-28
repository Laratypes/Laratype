import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// H6 #117 (DOC10 Q13): `sauf make:middleware` writes a stub for the v1 typed middleware API. Runs the BUILT sauf
// (`packages/sauf/dist`), like packages/sauf/__tests__/manifest/cli.test.ts and devSsr.test.ts: run `bun run build`
// first.

const saufBin = fileURLToPath(new URL("../dist/index.esm.js", import.meta.url));
const here = fileURLToPath(new URL(".", import.meta.url));

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

beforeAll(() => {
  if (!existsSync(saufBin)) throw new Error(`${saufBin} not found: run \`bun run build\` before this test.`);
  // Inside the repo, so the project resolves the workspace packages
  project = mkdtempSync(join(here, ".make-"));
  const write = (file: string, content: string) => {
    mkdirSync(dirname(join(project, file)), { recursive: true });
    writeFileSync(join(project, file), content);
  };
  write("package.json", JSON.stringify({ name: "make-middleware-fixture", version: "0.0.0", type: "module" }));
  write("app/config/config.ts", "export default { name: 'fixture' };\n");
  write("app/config/providers.ts", "export default [];\n");
});

afterAll(() => {
  if (project) rmSync(project, { recursive: true, force: true });
});

describe("sauf make:middleware", () => {
  it("writes a v1 typed middleware stub, and skips an existing file", async () => {
    const created = await sauf("make:middleware", "Audit");
    expect(created.code, created.output).toBe(0);
    const file = join(project, "src/http/middleware/Audit.ts");
    expect(existsSync(file)).toBe(true);
    const stub = readFileSync(file, "utf-8");
    expect(stub).toContain('import { defineMiddleware } from "@laratype/http";');
    expect(stub).toContain("export const Audit = defineMiddleware((_request, next) => next());");
    // a second run keeps the file
    const again = await sauf("make:middleware", "Audit");
    expect(again.code, again.output).toBe(0);
    expect(again.output).toContain("[SKIPPED]");
    expect(readFileSync(file, "utf-8")).toBe(stub);
  }, 120_000);
});
