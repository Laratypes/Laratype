import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import OpenApiGenerateCommand from "../../src/commands/openapi/generate";
import { OpenApiGenerationError, generateOpenApiFile } from "../../src/openapi";
import type { OpenApiProjectOptions } from "../../src/openapi";
import { bootsApp } from "../../src/utils/command";
import { contractRuntime } from "./support";

/**
 * `sauf openapi:generate` end to end without the app: the fixture tree is scanned, the generated index is imported
 * and the document is written. The project's `@laratype/contract` is passed in where the test needs the pipeline
 * alone (a temp project outside the repo has no resolvable copy), and loaded from the project where it can be.
 */
const here = fileURLToPath(new URL(".", import.meta.url));
const fixture = fileURLToPath(new URL("../typegen/fixtures/project/app", import.meta.url));
const slash = (path: string) => path.replace(/\\/g, "/");

// vitest's loader stands in for the app's Vite runner: its aliases resolve @laratype/contract and zod
const load = (url: string) => import(/* @vite-ignore */ url);

let tmp: string;

const project = (name: string, config?: string): string => {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  cpSync(fixture, join(dir, "app"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "openapi-fixture", version: "1.2.3" }));
  if (config !== undefined) {
    mkdirSync(join(dir, "app/config"), { recursive: true });
    writeFileSync(join(dir, "app/config/config.ts"), config);
  }
  return dir;
};

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "laratype-openapi-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("sauf openapi:generate", () => {
  it("is a command that boots no app and needs no provider", async () => {
    expect(OpenApiGenerateCommand.signature).toContain("openapi:generate");
    expect(bootsApp(OpenApiGenerateCommand)).toBe(false);
    expect(await new OpenApiGenerateCommand().providers()).toEqual([]);
  });

  it("scans the tree, imports the generated appApi and writes openapi.json", async () => {
    const dir = project("basic");
    const result = await generateOpenApiFile({ projectDir: dir, load, contract: contractRuntime });

    expect(result.file).toBe("openapi.json");
    expect(result.changed).toBe(true);
    expect(result.document.info).toEqual({ title: "openapi-fixture", version: "1.2.3" });
    expect(Object.keys(result.document.paths)).toEqual([
      "/api/users",
      "/api/users/{user}",
      "/api/users/{user}/posts",
      "/api/users/{user}/posts/{post}",
      "/api/v1/health",
    ]);
    // the fixture's UserDto has a z.date(): three response schemas fall back to {} with a warning each
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings[0]).toContain(": the response schema has no JSON Schema (Date cannot be represented");
    expect(existsSync(join(dir, ".laratype", "api", "index.gen.ts"))).toBe(true);

    const written = readFileSync(join(dir, "openapi.json"), "utf8");
    expect(JSON.parse(written)).toEqual(result.document);
    await expect(written).toMatchFileSnapshot("__snapshots__/fixture-openapi.json");
  }, 60_000);

  it("leaves an unchanged document untouched", async () => {
    const dir = project("unchanged");
    await generateOpenApiFile({ projectDir: dir, load, contract: contractRuntime });
    const file = join(dir, "openapi.json");
    const mtime = statSync(file).mtimeMs;
    const again = await generateOpenApiFile({ projectDir: dir, load, contract: contractRuntime });
    expect(again.changed).toBe(false);
    expect(statSync(file).mtimeMs).toBe(mtime);
  }, 60_000);

  it("honours --root, --base, --gen and --out", async () => {
    const dir = project("flags");
    cpSync(join(dir, "app", "api"), join(dir, "app", "contracts"), { recursive: true });
    const result = await generateOpenApiFile({
      projectDir: dir,
      root: "app/contracts",
      base: "/v2",
      gen: "gen",
      out: "docs/openapi.json",
      load,
      contract: contractRuntime,
    });
    expect(result.file).toBe("docs/openapi.json");
    expect(existsSync(join(dir, "gen", "api", "index.gen.ts"))).toBe(true);
    expect(Object.keys(result.document.paths)[0]).toBe("/v2/users");
    expect(existsSync(join(dir, "docs", "openapi.json"))).toBe(true);
  }, 60_000);

  it("reads api.root / api.base from app/config/config.ts, warning and falling back when it cannot be imported alone", async () => {
    const dir = project("config", "import { base } from '@app/base'\nexport default { api: { base } }\n");
    const result = await generateOpenApiFile({ projectDir: dir, load, contract: contractRuntime });
    expect(result.warnings[0]).toMatch(
      /^app\/config\/config\.ts could not be imported on its own .*@app\/base.*; using --root \/ --base and the defaults \(app\/api, \/api\) instead of config api$/s,
    );
    expect(Object.keys(result.document.paths)[0]).toBe("/api/users");
  }, 60_000);

  it("rejects an --out that is not a file inside the project, before writing anything", async () => {
    const dir = project("out");
    for (const out of ["../outside.json", "/absolute.json", "."]) {
      await expect(generateOpenApiFile({ projectDir: dir, out, load, contract: contractRuntime })).rejects.toThrow(
        `the output file "${out}" (--out) must be a file inside the project`,
      );
    }
    mkdirSync(join(dir, "docs"), { recursive: true });
    await expect(generateOpenApiFile({ projectDir: dir, out: "docs", load, contract: contractRuntime })).rejects.toThrow(
      'the output file "docs" (--out) is a directory',
    );
    expect(existsSync(join(dir, ".laratype"))).toBe(false);
  }, 60_000);

  it("rejects wrong-typed options with one diagnostic", async () => {
    const cases: Array<[unknown, string]> = [
      [undefined, "projectDir must be the project folder"],
      [null, "projectDir must be the project folder"],
      [{}, "projectDir must be the project folder"],
      [{ projectDir: 1 }, "projectDir must be the project folder"],
      [{ projectDir: "" }, "projectDir must be the project folder"],
      [{ projectDir: { length: 1e9 } }, "projectDir must be the project folder"],
      [{ projectDir: tmp, out: 1 }, "--out must be a string"],
      [{ projectDir: tmp, gen: null }, "--gen must be a string"],
      [{ projectDir: tmp, load: 1 }, "load must be a module loader"],
    ];
    for (const [options, message] of cases) {
      await expect(generateOpenApiFile(options as OpenApiProjectOptions)).rejects.toThrow(
        `[sauf openapi:generate] ${message}`,
      );
    }
  });

  it("fails with one clear diagnostic when the project has no resolvable @laratype/contract", async () => {
    // outside the repo: resolution from the project root finds no package, and the raw resolution error stays the cause
    const dir = project("no-contract");
    const error = await generateOpenApiFile({ projectDir: dir, load }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(OpenApiGenerationError);
    expect((error as Error).message).toBe(
      `[sauf openapi:generate] the project at ${slash(dir)} has no resolvable @laratype/contract dependency: add it to the project's dependencies`,
    );
    expect((error as Error).message).not.toContain("\n");
    expect((error as Error).message).not.toContain("Cannot find module");
  }, 60_000);

  it("loads the project's own @laratype/contract and appApi through jiti (no override)", async () => {
    // inside the repo, so the project resolves the workspace packages the contract modules import
    const dir = mkdtempSync(join(here, ".tmp-"));
    try {
      cpSync(fixture, join(dir, "app"), { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "own-contract", version: "3.0.0" }));
      const result = await generateOpenApiFile({ projectDir: dir });
      expect(result.document.info).toEqual({ title: "own-contract", version: "3.0.0" });
      expect(result.document.paths["/api/users"]!.get!.operationId).toBe("users.index");
      expect(result.warnings).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
