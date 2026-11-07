// E4 #136: the FE type-check CI step. It type-checks examples/fullstack-vue with its own tsconfig (never the repo
// tsconfig), pins what the FE program loads, and proves that changing a contract field breaks the FE type-check by
// overlaying a mutated copy of examples/basic's contracts. `bun run test --run` runs this project in CI.
import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { generateTypeOverlay } from "../scripts/generate-types";

const exampleDir = fileURLToPath(new URL("../", import.meta.url));
const basicDir = fileURLToPath(new URL("../../basic/", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const vueTsc = createRequire(import.meta.url).resolve("vue-tsc/bin/vue-tsc.js");

/** One `vue-tsc -p <tsconfig>` run: its exit status and output lines (diagnostics, or files with --listFilesOnly). */
const run = (tsconfig: string, cwd: string, ...args: string[]) => {
  const child = spawnSync(process.execPath, [vueTsc, "-p", tsconfig, "--noEmit", ...args], { cwd, encoding: "utf-8" });
  const lines = `${child.stdout}${child.stderr}`.split(/\r?\n/).filter(Boolean);
  return { status: child.status, lines };
};

const typecheck = (tsconfig: string, cwd: string) => {
  const { status, lines } = run(tsconfig, cwd);
  return { status, diagnostics: lines.filter((line) => /error TS\d+/.test(line)) };
};

/** Every file of the program, as absolute paths (tsc's `--listFilesOnly` output). */
const listFiles = (tsconfig: string, cwd: string): string[] =>
  run(tsconfig, cwd, "--listFilesOnly").lines.filter(
    (line) => /^([A-Za-z]:)?[\\/]/.test(line) && !/error TS\d+/.test(line),
  );

const slash = (path: string) => path.replace(/\\/g, "/");

const copy = (from: string, to: string) => {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
};

const overlayDir = `${exampleDir}.laratype/overlay`;
const overlayExample = `${overlayDir}/examples/fullstack-vue/`;
const overlayBasic = `${overlayDir}/examples/basic/`;

/** A copy of the FE with its contracts and generated `$types.d.ts`, so a mutation never touches the real files. */
const writeOverlay = (): string => {
  copy(`${exampleDir}src`, `${overlayExample}src`);
  copy(`${exampleDir}.laratype/basic/types`, `${overlayExample}.laratype/basic/types`);
  copy(`${basicDir}app/api`, `${overlayBasic}app/api`);
  // The real tsconfig, except `@laratype/*` resolves to the real packages from the overlay's depth.
  const tsconfig = JSON.parse(readFileSync(`${exampleDir}tsconfig.json`, "utf-8")) as {
    compilerOptions: Record<string, unknown> & { paths: Record<string, string[]> };
    include: string[];
  };
  const toRoot = slash(relative(overlayExample, repoRoot));
  tsconfig.compilerOptions.paths = { "@laratype/*": [`${toRoot}/packages/*/src/index.ts`] };
  writeFileSync(`${overlayExample}tsconfig.json`, `${JSON.stringify(tsconfig, null, 2)}\n`);
  return `${overlayExample}tsconfig.json`;
};

beforeAll(() => {
  // The `$types.d.ts` overlay the FE tsconfig's `rootDirs` points at (`bun run types`).
  generateTypeOverlay();
});

describe("examples/fullstack-vue FE type-check", () => {
  it("type-checks with its own tsconfig and no diagnostics", () => {
    const { status, diagnostics } = typecheck(`${exampleDir}tsconfig.json`, exampleDir);
    expect(diagnostics).toEqual([]);
    expect(status).toBe(0);
  }, 120_000);

  it("loads no server file and no examples/basic file outside app/api", () => {
    const tsconfig = `${exampleDir}tsconfig.json`;
    const files = listFiles(tsconfig, exampleDir).map(slash);
    const root = slash(repoRoot);
    const basic = slash(basicDir);

    expect(files).toContain(`${root}examples/fullstack-vue/src/api.ts`);
    // .vue SFCs are part of the program: vue-tsc checks them
    expect(files).toContain(`${root}examples/fullstack-vue/src/App.vue`);
    expect(files).toContain(`${root}examples/basic/app/api/users.ts`);
    expect(files).toContain(`${root}examples/fullstack-vue/.laratype/basic/types/app/api/$types.d.ts`);
    expect(files.some((file) => file.startsWith(`${root}packages/client/src/`))).toBe(true);
    expect(files.some((file) => file.startsWith(`${root}packages/contract/src/`))).toBe(true);

    // The framework's server packages and the toolchain types
    expect(files.filter((file) => file.startsWith(`${root}packages/http/src/`))).toEqual([]);
    expect(files.filter((file) => file.startsWith(`${root}packages/support/src/`))).toEqual([]);
    expect(files.filter((file) => /[\\/]node_modules[\\/]hono[\\/]/.test(file))).toEqual([]);
    expect(files.filter((file) => /[\\/]node_modules[\\/]typeorm[\\/]/.test(file))).toEqual([]);
    expect(files.filter((file) => /[\\/]node_modules[\\/]@laratype[\\/](?:http|support)[\\/]/.test(file))).toEqual([]);
    // The FE imports contracts only: nothing of examples/basic except app/api's files
    expect(files.filter((file) => file.startsWith(basic) && !file.startsWith(`${basic}app/api/`))).toEqual([]);
  }, 120_000);

  it("fails with a diagnostic in the FE code when a contract field changes (UserDto.email renamed)", () => {
    const tsconfig = writeOverlay();
    const before = typecheck(tsconfig, overlayExample);
    expect(before.diagnostics).toEqual([]);
    expect(before.status).toBe(0);

    const users = `${overlayBasic}app/api/users.ts`;
    const source = readFileSync(users, "utf-8");
    const mutated = source.replace("  email: z.string(),", "  emailAddress: z.string(),");
    // The contract field this test is about moved: fail loudly rather than pass on a stale expect
    expect(mutated).not.toBe(source);
    writeFileSync(users, mutated);

    const after = typecheck(tsconfig, overlayExample);
    expect(after.status).not.toBe(0);
    const fieldErrors = after.diagnostics.filter((line) => /Property 'email' does not exist/.test(line));
    expect(fieldErrors.length).toBeGreaterThan(0);
    // ... and it is the FE code (the Vue component and the API module) that sees it
    expect(fieldErrors.some((line) => /src[\\/](?:App\.vue|api\.ts)/.test(line))).toBe(true);
  }, 120_000);
});
