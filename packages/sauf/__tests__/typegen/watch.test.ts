import { EventEmitter } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { laratypeApi } from "../../src/typegen";
import type { ApiPluginApi } from "../../src/typegen";
import { coalesce } from "../../src/typegen/plugin";
import { ContractTypeWatch, ContractTypeWatchHost } from "../../src/typegen/watch";
import type { ContractTypeWatchOptions, WatchEvents } from "../../src/typegen/watch";

/**
 * The type watch of `sauf dev` (G2 #142): Vite watcher events (stubbed here, real Vite's in one test) debounced into
 * one `laratype:api` refresh; a content edit needs no scan because the generated files import the contract file.
 */
const here = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\\/g, "/");

const appTsconfig = {
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    strict: true,
    verbatimModuleSyntax: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
    lib: ["ES2022", "DOM"],
    rootDirs: [".", ".laratype/types"],
    paths: {
      $api: ["./.laratype/api/index.gen.ts"],
      "@laratype/contract": [`${repo}packages/contract/src/index.ts`],
      zod: [`${repo}node_modules/zod`],
    },
  },
  include: ["app", ".laratype", "fe"],
};

type Events = EventEmitter & WatchEvents;

const fakeEvents = (): Events => new EventEmitter() as Events;

const treeOf = (api: ApiPluginApi, scans?: { count: number }): ContractTypeWatchOptions["tree"] => ({
  affectsTree: api.affectsTree,
  isGenerated: api.isGenerated,
  refresh: async () => {
    if (scans) scans.count++;
    await api.refresh();
  },
});

let tmp: string;

/** A temp project with the G1 fixture tree; config.ts is optional (a plugin with `config` does not read it). */
const project = (name: string, config?: string) => {
  const dir = join(tmp, name);
  mkdirSync(join(dir, "app"), { recursive: true });
  cpSync(join(here, "fixtures/project/app/api"), join(dir, "app/api"), { recursive: true });
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(appTsconfig, null, 2));
  if (config !== undefined) {
    mkdirSync(join(dir, "app/config"), { recursive: true });
    writeFileSync(join(dir, "app/config/config.ts"), config);
  }
  return dir;
};

/** Opens the plugin as `sauf dev` does on the first `$api` import and returns its API and generated index id. */
const opened = async (dir: string, options: { config?: () => unknown } = {}) => {
  const plugin = laratypeApi({ projectDir: dir, config: options.config ?? (() => ({})) });
  const id = await (plugin.resolveId as (source: string) => Promise<string | null>)("$api");
  return { api: plugin.api as ApiPluginApi, index: id! };
};

const indexOf = (dir: string) => readFileSync(join(dir, ".laratype/api/index.gen.ts"), "utf8");

const typeFile = (dir: string, path: string) => join(dir, ".laratype/types", path, "$types.d.ts");

const format = (diagnostics: readonly ts.Diagnostic[]) =>
  diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "laratype-watch-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("ContractTypeWatch", () => {
  it("regenerates the new folder's $types.d.ts and the index on an add, without a restart", async () => {
    const dir = project("add");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const errors: unknown[] = [];
    const watch = new ContractTypeWatch({ events, tree: treeOf(api), delay: 0, onError: (e) => errors.push(e) });

    const file = join(dir, "app/api/reports/index.ts");
    mkdirSync(join(dir, "app/api/reports"), { recursive: true });
    writeFileSync(file, "export default {}\n");
    events.emit("add", file);
    await watch.idle();

    expect(errors).toEqual([]);
    expect(indexOf(dir)).toContain("'reports': { contract: c0");
    expect(existsSync(typeFile(dir, "app/api/reports"))).toBe(true);
    expect(readFileSync(typeFile(dir, "app/api/reports"), "utf8")).toContain("export type Prefix = ContractPrefix<'/api/reports'");
  });

  it("follows a rename as unlink + add", async () => {
    const dir = project("rename");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const watch = new ContractTypeWatch({ events, tree: treeOf(api), delay: 0 });

    renameSync(join(dir, "app/api/users.ts"), join(dir, "app/api/people.ts"));
    events.emit("unlink", join(dir, "app/api/users.ts"));
    events.emit("add", join(dir, "app/api/people.ts"));
    await watch.idle();
    expect(indexOf(dir)).toContain("'people':");
    expect(indexOf(dir)).not.toContain("'users':");
    // users.posts still exists: only the file's entry goes
    expect(indexOf(dir)).toContain("'users.posts':");
  });

  it("removes the stale $types.d.ts of a deleted folder", async () => {
    const dir = project("delete");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const watch = new ContractTypeWatch({ events, tree: treeOf(api), delay: 0 });

    rmSync(join(dir, "app/api/v1"), { recursive: true });
    events.emit("unlink", join(dir, "app/api/v1/health/index.ts"));
    await watch.idle();
    expect(indexOf(dir)).not.toContain("v1.health");
    expect(existsSync(typeFile(dir, "app/api/v1"))).toBe(false);
  });

  it("re-reads a changed config api.root / api.base and moves the generated types", async () => {
    const dir = project("config", "export default { api: { root: 'app/api' } }\n");
    const plugin = laratypeApi({ projectDir: dir });
    await (plugin.resolveId as (source: string) => Promise<string | null>)("$api");
    const api = plugin.api as ApiPluginApi;
    const events = fakeEvents();
    const watch = new ContractTypeWatch({ events, tree: treeOf(api), delay: 0 });

    writeFileSync(join(dir, "app/config/config.ts"), "export default { api: { root: 'app/api', base: '/v2' } }\n");
    events.emit("change", join(dir, "app/config/config.ts"));
    await watch.idle();
    expect(indexOf(dir)).toContain("path: '/v2/users'");
    // the old base is gone from every generated path
    expect(indexOf(dir)).not.toContain("path: '/api/users'");

    // app/api still exists: the config change alone must move the output and prune the old root's types
    mkdirSync(join(dir, "app/contracts"), { recursive: true });
    writeFileSync(join(dir, "app/contracts/fresh.ts"), "export default {}\n");
    writeFileSync(join(dir, "app/config/config.ts"), "export default { api: { root: 'app/contracts', base: '/v3' } }\n");
    events.emit("change", join(dir, "app/config/config.ts"));
    await watch.idle();
    expect(indexOf(dir)).toContain("path: '/v3/fresh'");
    expect(indexOf(dir)).not.toContain("path: '/v2/users'");
    expect(existsSync(typeFile(dir, "app/api"))).toBe(false);
    expect(existsSync(typeFile(dir, "app/contracts"))).toBe(true);
    // only .laratype changed: the old root's contracts are still on disk
    expect(existsSync(join(dir, "app/api/users.ts"))).toBe(true);
  }, 30_000);

  it("logs a scan error and keeps the last good output", async () => {
    const dir = project("invalid");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const errors: unknown[] = [];
    const watch = new ContractTypeWatch({ events, tree: treeOf(api), delay: 0, onError: (e) => errors.push(e) });
    const before = indexOf(dir);

    const bad = join(dir, "app/api/bad.name.ts");
    writeFileSync(bad, "export default {}\n");
    events.emit("add", bad);
    await watch.idle();
    expect(errors.map(String)).toEqual(['ScanError: [laratype:api] "bad.name.ts": file name "bad.name" may only use letters, digits, "_" and "-" (use a [x] folder for params)']);
    expect(indexOf(dir)).toBe(before);
  });

  it("recovers on the next good save after a scan error", async () => {
    const dir = project("recover");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const errors: unknown[] = [];
    const watch = new ContractTypeWatch({ events, tree: treeOf(api), delay: 0, onError: (e) => errors.push(e) });

    const bad = join(dir, "app/api/bad.name.ts");
    writeFileSync(bad, "export default {}\n");
    events.emit("add", bad);
    await watch.idle();
    expect(errors).toHaveLength(1);

    rmSync(bad);
    const good = join(dir, "app/api/good.ts");
    writeFileSync(good, "export default {}\n");
    events.emit("unlink", bad);
    events.emit("add", good);
    await watch.idle();
    expect(indexOf(dir)).toContain("'good':");
    expect(errors).toHaveLength(1);
  });

  it("does not scan on a content edit", async () => {
    const dir = project("content");
    const { api, index } = await opened(dir);
    mkdirSync(join(dir, "fe"), { recursive: true });
    const check = join(dir, "fe/check.ts");
    writeFileSync(
      check,
      [
        "import type { ApiTypes } from '@laratype/contract'",
        "import { appApi } from '$api'",
        "type Body = ApiTypes<typeof appApi>['users']['store']['body']",
        "declare const body: Body",
        "export const name: string = body.name",
        "",
      ].join("\n"),
    );
    const diagnostics = () => {
      const { config } = ts.readConfigFile(join(dir, "tsconfig.json"), ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(config, ts.sys, dir);
      return format(ts.getPreEmitDiagnostics(ts.createProgram([check], parsed.options)));
    };
    expect(diagnostics()).toEqual([]);

    const scans = { count: 0 };
    const events = fakeEvents();
    const watch = new ContractTypeWatch({ events, tree: treeOf(api, scans), delay: 0 });
    const before = indexOf(dir);
    const typesPath = typeFile(dir, "app/api");
    const mtime = statSync(typesPath).mtimeMs;

    // The same contract file, no rename: its body schema changes from a string to a number
    const users = join(dir, "app/api/users.ts");
    writeFileSync(
      users,
      readFileSync(users, "utf8").replace(
        "body(z.object({ name: z.string(), email: z.string() }))",
        "body(z.object({ name: z.number(), email: z.string() }))",
      ),
    );
    events.emit("change", users);
    await watch.idle();

    expect(scans.count).toBe(0);
    expect(indexOf(dir)).toBe(before);
    expect(statSync(typesPath).mtimeMs).toBe(mtime);
    // The FE program imports $api -> index.gen.ts -> app/api/users.ts: the new body type reaches it with no scan
    expect(diagnostics()).toEqual([expect.stringContaining("Type 'number' is not assignable to type 'string'.")]);
  }, 30_000);

  it("debounces a burst into one scan, and coalesces events that arrive during a scan into one more", async () => {
    const dir = project("burst");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const scans = { count: 0 };
    const watch = new ContractTypeWatch({ events, tree: treeOf(api, scans), delay: 1 });
    for (let i = 0; i < 1000; i++) events.emit("add", join(dir, `app/api/burst-${i}.ts`));
    await watch.idle();
    expect(scans.count).toBe(1);

    // Events that land while a scan runs queue exactly one follow-up, never a concurrent scan
    let release!: () => void;
    let started!: () => void;
    const scanning = new Promise<void>((resolve) => (started = resolve));
    let active = 0;
    let max = 0;
    let runs = 0;
    const running = fakeEvents();
    const slow = new ContractTypeWatch({
      events: running,
      delay: 0,
      tree: {
        affectsTree: () => true,
        isGenerated: () => false,
        refresh: async () => {
          runs++;
          active++;
          max = Math.max(max, active);
          started();
          if (runs === 1) await new Promise<void>((r) => (release = r));
          active--;
        },
      },
    });
    running.emit("add", join(dir, "app/api/a.ts"));
    await scanning;
    running.emit("add", join(dir, "app/api/b.ts"));
    running.emit("add", join(dir, "app/api/c.ts"));
    expect(max).toBe(1);
    release();
    await slow.idle();
    expect(runs).toBe(2);
    expect(max).toBe(1);
  });

  it("runs once more for events that arrive after the scan's last check but before its completion callback", async () => {
    const events = fakeEvents();
    let started!: () => void;
    const scanning = new Promise<void>((resolve) => (started = resolve));
    let release!: () => void;
    const first = new Promise<void>((resolve) => (release = resolve));
    let runs = 0;
    const watch = new ContractTypeWatch({
      events,
      delay: 0,
      tree: {
        affectsTree: () => true,
        isGenerated: () => false,
        refresh: () => {
          runs++;
          if (runs === 1) {
            started();
            return first;
          }
          return Promise.resolve();
        },
      },
    });
    events.emit("add", "app/api/a.ts");
    await scanning;
    release();
    // The scan's continuation has already checked `requested`; these two events land before its completion callback
    await Promise.resolve().then(() => {
      events.emit("add", "app/api/b.ts");
      events.emit("add", "app/api/c.ts");
    });
    await watch.idle();
    expect(runs).toBe(2);
  });

  it("resets the debounce on every event", async () => {
    vi.useFakeTimers();
    try {
      const events = fakeEvents();
      const scans = { count: 0 };
      const watch = new ContractTypeWatch({
        events,
        delay: 30,
        tree: { affectsTree: () => true, isGenerated: () => false, refresh: async () => { scans.count++; } },
      });
      events.emit("add", "app/api/a.ts");
      await vi.advanceTimersByTimeAsync(20);
      events.emit("add", "app/api/b.ts");
      await vi.advanceTimersByTimeAsync(20);
      events.emit("add", "app/api/c.ts");
      await vi.advanceTimersByTimeAsync(29);
      expect(scans.count).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      await watch.idle();
      expect(scans.count).toBe(1);
      watch.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores generated files, paths outside the tree, private and non-module paths", async () => {
    const dir = project("ignored");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const scans = { count: 0 };
    const watch = new ContractTypeWatch({ events, tree: treeOf(api, scans), delay: 0 });

    for (const [event, file] of [
      ["add", join(dir, ".laratype/api/index.gen.ts")],
      ["change", join(dir, ".laratype/types/app/api/$types.d.ts")],
      ["add", join(tmp, "elsewhere.ts")],
      ["change", join(dir, "app/api/users.ts")],
      ["add", join(dir, "app/api/notes.md")],
      ["add", join(dir, "app/api/_private/x.ts")],
      ["add", join(dir, "app/api/$gen/x.ts")],
      ["add", join(dir, "app/api/__proto__/x.ts")],
      ["add", join(dir, "app/api/users.test.ts")],
    ] as const) {
      events.emit(event, file);
    }
    await watch.idle();
    expect(scans.count).toBe(0);
  });

  it("treats hostile event paths as triggers only: nothing outside the tree or .laratype is written", async () => {
    const dir = project("hostile");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const scans = { count: 0 };
    const errors: unknown[] = [];
    const watch = new ContractTypeWatch({ events, tree: treeOf(api, scans), delay: 0, onError: (e) => errors.push(e) });
    const before = indexOf(dir);

    const long = `app/api/${"a".repeat(4000)}.ts`;
    for (const file of [
      join(dir, long),
      join(dir, "app/api/control\u0001name.ts"),
      join(dir, "app/api/lone\uD800.ts"),
      `app/api/${"__proto__"}/x.ts`,
    ]) {
      events.emit("add", file);
    }
    await watch.idle();
    expect(scans.count).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    expect(indexOf(dir)).toBe(before);
  });

  it("on a unicode file name the diagnostic is the scan's, the last output stays, and deleting it recovers", async () => {
    const dir = project("unicode");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const errors: unknown[] = [];
    const watch = new ContractTypeWatch({ events, tree: treeOf(api), delay: 0, onError: (e) => errors.push(e) });
    const before = indexOf(dir);

    const cafe = join(dir, "app/api/café.ts");
    writeFileSync(cafe, "export default {}\n");
    events.emit("add", cafe);
    await watch.idle();
    expect(errors.map(String)).toEqual(['ScanError: [laratype:api] "café.ts": file name "café" may only use letters, digits, "_" and "-" (use a [x] folder for params)']);
    expect(indexOf(dir)).toBe(before);

    rmSync(cafe);
    events.emit("unlink", cafe);
    await watch.idle();
    expect(errors).toHaveLength(1);
    expect(indexOf(dir)).toBe(before);
  });

  it("a syntax error in a contract is not a scan error: the name-only scan keeps generating", async () => {
    const dir = project("syntax");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const errors: unknown[] = [];
    const scans = { count: 0 };
    const watch = new ContractTypeWatch({ events, tree: treeOf(api, scans), delay: 0, onError: (e) => errors.push(e) });

    const users = join(dir, "app/api/users.ts");
    writeFileSync(users, "export default {\n");
    events.emit("change", users);
    await watch.idle();
    expect(scans.count).toBe(0);

    const added = join(dir, "app/api/after.ts");
    writeFileSync(added, "export default {}\n");
    events.emit("add", added);
    await watch.idle();
    expect(scans.count).toBe(1);
    expect(errors).toEqual([]);
    expect(indexOf(dir)).toContain("'after':");
  });

  it("does not follow a symlink or junction in the tree that points outside it", async (ctx) => {
    const dir = project("symlink");
    const outside = join(tmp, "outside-symlink");
    mkdirSync(join(outside, "nested"), { recursive: true });
    writeFileSync(join(outside, "nested", "secret.ts"), "export default {}\n");
    const link = join(dir, "app/api/linked");
    try {
      // A junction needs no privilege on Windows; a directory symlink does on POSIX-less Windows
      symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      ctx.skip("the OS refused to create a junction or directory symlink in the contract tree");
      return;
    }

    const { api } = await opened(dir);
    expect(indexOf(dir)).not.toContain("linked");
    expect(existsSync(typeFile(dir, "app/api/linked"))).toBe(false);

    const events = fakeEvents();
    const scans = { count: 0 };
    const watch = new ContractTypeWatch({ events, tree: treeOf(api, scans), delay: 0 });
    events.emit("add", join(link, "nested", "secret.ts"));
    await watch.idle();
    // The event only asks for a rescan by name; the scan never follows the link and never writes outside .laratype
    expect(readFileSync(join(outside, "nested", "secret.ts"), "utf8")).toBe("export default {}\n");
    expect(indexOf(dir)).not.toContain("linked");
    expect(existsSync(typeFile(dir, "app/api/linked"))).toBe(false);

    // A file symlink too, where the OS allows it: Windows without developer mode refuses one and the junction above
    // is its documented stand-in (condition on #142's checklist a).
    try {
      symlinkSync(join(outside, "nested", "secret.ts"), join(dir, "app/api/secret-link.ts"), "file");
    } catch {
      return;
    }
    const filePlugin = laratypeApi({ projectDir: dir, config: () => ({}) });
    await (filePlugin.resolveId as (source: string) => Promise<string | null>)("$api");
    expect(indexOf(dir)).not.toContain("secret-link");
    expect(readFileSync(join(outside, "nested", "secret.ts"), "utf8")).toBe("export default {}\n");
  });

  it("refuses a junction or symlink under .laratype that points outside the project, and writes nothing outside", async (ctx) => {
    const dir = project("realpath");
    const outside = join(tmp, "outside-realpath");
    const outsideTypes = join(tmp, "outside-types");
    mkdirSync(outside, { recursive: true });
    mkdirSync(outsideTypes, { recursive: true });
    const { api } = await opened(dir);
    const linkType = process.platform === "win32" ? "junction" : "dir";
    const typesDir = join(dir, ".laratype/types");
    const usersDir = join(typesDir, "app/api/users");
    const index = indexOf(dir);
    const typesFile = readFileSync(typeFile(dir, "app/api"), "utf8");

    // A junction/symlink planted inside the tree wins over the target's lexical path: the write must be refused
    rmSync(usersDir, { recursive: true, force: true });
    try {
      symlinkSync(outside, usersDir, linkType);
    } catch {
      ctx.skip(`the OS refused to create a ${linkType} under .laratype/types`);
      return;
    }
    const events = fakeEvents();
    const errors: unknown[] = [];
    const watch = new ContractTypeWatch({ events, tree: treeOf(api), delay: 0, onError: (e) => errors.push(e) });
    events.emit("add", join(dir, "app/api/users.ts"));
    await watch.idle();
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('the output path ".laratype/types/app/api/users/[user]/$types.d.ts" resolves outside the project');
    expect(String(errors[0])).toContain("a junction or symlink under the output folder must stay inside it");
    expect(readdirSync(outside)).toEqual([]);
    // checked before removeStaleTypes and the writes: the last good output is untouched
    expect(indexOf(dir)).toBe(index);
    expect(readFileSync(typeFile(dir, "app/api"), "utf8")).toBe(typesFile);

    // The output folder itself, not just a folder inside it, can be the planted link
    rmSync(usersDir, { recursive: true, force: true });
    rmSync(typesDir, { recursive: true, force: true });
    symlinkSync(outsideTypes, typesDir, linkType);
    errors.length = 0;
    events.emit("add", join(dir, "app/api/users.ts"));
    await watch.idle();
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('the output path ".laratype/types" resolves outside the project');
    expect(readdirSync(outsideTypes)).toEqual([]);
    expect(indexOf(dir)).toBe(index);

    // A broken link cannot be shown to stay inside either; only an OS that can create one runs this branch
    rmSync(typesDir, { recursive: true, force: true });
    try {
      symlinkSync(join(tmp, "missing-realpath-target"), typesDir, linkType);
    } catch {
      watch.dispose();
      return;
    }
    errors.length = 0;
    events.emit("add", join(dir, "app/api/users.ts"));
    await watch.idle();
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('the output path ".laratype/types" resolves outside the project');
    watch.dispose();
  });

  it("keeps the last output when the whole tree is deleted, and regenerates when it comes back", async () => {
    const dir = project("whole-tree");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const watch = new ContractTypeWatch({ events, tree: treeOf(api), delay: 0 });
    const before = indexOf(dir);

    rmSync(join(dir, "app/api"), { recursive: true });
    events.emit("unlink", join(dir, "app/api/users.ts"));
    await watch.idle();
    expect(indexOf(dir)).toBe(before);
    expect(existsSync(typeFile(dir, "app/api"))).toBe(true);

    mkdirSync(join(dir, "app/api"), { recursive: true });
    writeFileSync(join(dir, "app/api/fresh.ts"), "export default {}\n");
    events.emit("add", join(dir, "app/api/fresh.ts"));
    await watch.idle();
    expect(indexOf(dir)).toContain("'fresh':");
    expect(indexOf(dir)).not.toContain("'users'");
    // the old folders' $types.d.ts files are gone, not just overwritten
    expect(existsSync(typeFile(dir, "app/api/users/[user]"))).toBe(false);
  });

  it("dispose() stops listening and drops a pending debounce", async () => {
    const dir = project("dispose");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const scans = { count: 0 };
    const watch = new ContractTypeWatch({ events, tree: treeOf(api, scans), delay: 1000 });
    events.emit("add", join(dir, "app/api/users.ts"));
    watch.dispose();
    watch.dispose();
    await watch.idle();
    expect(scans.count).toBe(0);
    for (const event of ["add", "change", "unlink"]) expect(events.listenerCount(event)).toBe(0);
  });
});

describe("ContractTypeWatchHost", () => {
  it("keeps one live watch across N app restarts and scans a burst once", async () => {
    const dir = project("host");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const scans = { count: 0 };
    const host = new ContractTypeWatchHost();
    for (let i = 0; i < 5; i++) {
      host.open({ events, tree: treeOf(api, scans), delay: 1 });
      expect(host.active).toBe(true);
      for (const event of ["add", "change", "unlink"]) expect(events.listenerCount(event)).toBe(1);
    }
    for (let i = 0; i < 100; i++) events.emit("add", join(dir, `app/api/restart-${i}.ts`));
    await host.idle();
    expect(scans.count).toBe(1);

    host.close();
    expect(host.active).toBe(false);
    for (const event of ["add", "change", "unlink"]) expect(events.listenerCount(event)).toBe(0);
    host.close();
  });

  it("rejects a wrong options object without disturbing the live watch's listeners", async () => {
    const dir = project("host-bad-open");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const scans = { count: 0 };
    const host = new ContractTypeWatchHost();
    host.open({ events, tree: treeOf(api, scans), delay: 0 });
    expect(events.listenerCount("add")).toBe(1);

    expect(() => host.open(null as unknown as ContractTypeWatchOptions)).toThrow("the type watch needs an options object");
    // the new watch is built before the old is disposed, so a bad open() leaves the live watch in place
    expect(host.active).toBe(true);
    expect(events.listenerCount("add")).toBe(1);
    host.close();
    expect(events.listenerCount("add")).toBe(0);
  });

  it("replaces the previous watch: an event after close() does not scan", async () => {
    const dir = project("host-replace");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const scans = { count: 0 };
    const host = new ContractTypeWatchHost();
    host.open({ events, tree: treeOf(api, scans), delay: 0 });
    host.open({ events, tree: treeOf(api, scans), delay: 0 });
    host.close();
    events.emit("add", join(dir, "app/api/users.ts"));
    await host.idle();
    expect(scans.count).toBe(0);
  });
});

describe("coalesce", () => {
  it("runs one at a time and queues exactly one follow-up for calls during a run", async () => {
    let calls = 0;
    let active = 0;
    let max = 0;
    let release!: () => void;
    const task = coalesce(async () => {
      calls++;
      active++;
      max = Math.max(max, active);
      if (calls === 1) await new Promise<void>((resolve) => (release = resolve));
      active--;
    });
    const first = task.run();
    const second = task.run();
    expect(calls).toBe(1);
    await Promise.resolve();
    expect(calls).toBe(1);
    release();
    await first;
    await second;
    expect(calls).toBe(2);
    expect(max).toBe(1);
  });

  it("does not cache a failure: the next run retries", async () => {
    let calls = 0;
    const task = coalesce(async () => {
      calls++;
      if (calls === 1) throw new Error("first fails");
    });
    await expect(task.run()).rejects.toThrow("first fails");
    await task.run();
    expect(calls).toBe(2);
  });

  it("does not cache a task that throws synchronously: the next run runs, and the rejection is handled", async () => {
    let calls = 0;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const task = coalesce(() => {
        calls++;
        // The first step throws before any await, so drain() settles during run()'s synchronous call
        if (calls === 1) throw new Error("first fails synchronously");
        return Promise.resolve();
      });
      await expect(task.run()).rejects.toThrow("first fails synchronously");
      await task.run();
      expect(calls).toBe(2);
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it("does not drop a call that arrives during a failed run: it runs the follow-up and resolves", async () => {
    let calls = 0;
    const task = coalesce(async () => {
      calls++;
      if (calls === 1) throw new Error("first fails");
    });
    const first = task.run();
    const second = task.run();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});

describe("ContractTypeWatch options", () => {
  const tree = { affectsTree: () => true, isGenerated: () => false, refresh: async () => {} };

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["-1", -1],
    ["a string", "30"],
    ["null", null],
    ["an object", { length: 1_000_000_000 }],
  ])("rejects %s as a delay", (_name, delay) => {
    const events = fakeEvents();
    expect(() => new ContractTypeWatch({ events, tree, delay: delay as number })).toThrow(TypeError);
    expect(events.listenerCount("add")).toBe(0);
  });

  it("defaults an undefined delay and accepts 0", () => {
    const events = fakeEvents();
    const watch = new ContractTypeWatch({ events, tree, delay: undefined as number | undefined });
    const explicit = new ContractTypeWatch({ events, tree, delay: 0 });
    watch.dispose();
    explicit.dispose();
  });

  it("reads a non-enumerable delay key", () => {
    const events = fakeEvents();
    const options = Object.defineProperty({ events, tree }, "delay", { value: 0, enumerable: false }) as ContractTypeWatchOptions;
    const hidden = new ContractTypeWatch(options);
    hidden.dispose();
  });

  it("rejects a wrong events or tree object, and a non-function onError, before listening", () => {
    const events = fakeEvents();
    expect(() => new ContractTypeWatch(null as unknown as ContractTypeWatchOptions)).toThrow("the type watch needs an options object");
    expect(() => new ContractTypeWatch({ events: null as unknown as WatchEvents, tree })).toThrow("events must provide on() and off()");
    expect(() => new ContractTypeWatch({ events: {} as WatchEvents, tree })).toThrow("events must provide on() and off()");
    expect(() => new ContractTypeWatch({ events, tree: null as unknown as ContractTypeWatchOptions["tree"] })).toThrow(
      "tree needs affectsTree(), isGenerated() and refresh()",
    );
    expect(() => new ContractTypeWatch({ events, tree: {} as ContractTypeWatchOptions["tree"] })).toThrow(
      "tree needs affectsTree(), isGenerated() and refresh()",
    );
    expect(() => new ContractTypeWatch({ events, tree, onError: "log" as unknown as (error: unknown) => void })).toThrow(
      "onError must be a function",
    );
    expect(events.listenerCount("add")).toBe(0);
  });
});

describe("laratype:api refresh and coalescing", () => {
  it("refresh() does nothing before the first $api import, then rescans", async () => {
    const dir = project("refresh");
    const plugin = laratypeApi({ projectDir: dir, config: () => ({}) });
    const api = plugin.api as ApiPluginApi;

    await api.refresh();
    expect(existsSync(join(dir, ".laratype"))).toBe(false);

    await (plugin.resolveId as (source: string) => Promise<string | null>)("$api");
    writeFileSync(join(dir, "app/api/things.ts"), "export default {}\n");
    await api.refresh();
    expect(indexOf(dir)).toContain("'things':");
  });

  it("serializes overlapping rescans: calls during a scan coalesce into exactly one follow-up", async () => {
    const dir = project("overlap");
    let reads = 0;
    const plugin = laratypeApi({
      projectDir: dir,
      config: () => {
        reads++;
        return {};
      },
    });
    await (plugin.resolveId as (source: string) => Promise<string | null>)("$api");
    const api = plugin.api as ApiPluginApi;
    const before = reads;

    await Promise.all([api.rescan(), api.rescan(), api.rescan()]);
    // The first call scans; the two during it queue one more scan, not two concurrent ones
    expect(reads).toBe(before + 2);
  });
});

describe("the type watch on Vite's watcher", () => {
  it("sees real add/unlink events, ignores a change, and is disposed by the server close", async () => {
    const dir = project("vite");
    const { api } = await opened(dir);
    const events = fakeEvents();
    const scans = { count: 0 };
    const host = new ContractTypeWatchHost();
    let server!: ViteDevServer;
    server = await createServer({
      root: dir,
      configFile: false,
      logLevel: "silent",
      server: { middlewareMode: true, hmr: false },
      optimizeDeps: { noDiscovery: true },
      plugins: [
        {
          // what commands/dev.ts's `laratype:dev-server` plugin does
          name: "test:watch-close",
          closeBundle() {
            host.close();
          },
        },
      ],
    });
    try {
      // Vite's patched chokidar emits `ready` before the crawl ends. Wait until the deepest watched folders are in
      // getWatched(), so the initial walk has passed the tree before a test file is created.
      const watched = () =>
        Object.keys((server.watcher as unknown as { getWatched(): Record<string, string[]> }).getWatched()).map((p) =>
          p.replace(/\\/g, "/"),
        );
      const deepest = ["app/api/users/[user]", "app/api/v1/health"].map((p) => join(dir, p).replace(/\\/g, "/"));
      await new Promise<void>((resolve) => {
        const check = () => (deepest.every((p) => watched().includes(p)) ? resolve() : setTimeout(check, 10));
        check();
      });
      host.open({ events: server.watcher as unknown as WatchEvents, tree: treeOf(api, scans), delay: 0 });

      const next = (event: string, match: string) =>
        new Promise<void>((resolve) => {
          const listener = (file: string) => {
            if (!file.replace(/\\/g, "/").endsWith(match)) return;
            server.watcher.off(event, listener);
            resolve();
          };
          server.watcher.on(event, listener);
        });

      const added = next("add", "app/api/reports/index.ts");
      mkdirSync(join(dir, "app/api/reports"), { recursive: true });
      writeFileSync(join(dir, "app/api/reports/index.ts"), "export default {}\n");
      await added;
      await host.idle();
      expect(indexOf(dir)).toContain("'reports':");

      // a rename is unlink + add on the real watcher, and the index follows both
      const renamed = Promise.all([
        next("unlink", "app/api/reports/index.ts"),
        next("add", "app/api/reports/renamed.ts"),
      ]);
      renameSync(join(dir, "app/api/reports/index.ts"), join(dir, "app/api/reports/renamed.ts"));
      await renamed;
      await host.idle();
      expect(indexOf(dir)).toContain("'reports.renamed':");
      expect(indexOf(dir)).not.toContain("'reports':");

      // a content edit reaches the watcher but never a scan
      scans.count = 0;
      const changed = next("change", "app/api/users.ts");
      writeFileSync(join(dir, "app/api/users.ts"), readFileSync(join(dir, "app/api/users.ts"), "utf8"));
      await changed;
      await host.idle();
      expect(scans.count).toBe(0);

      const removed = next("unlink", "app/api/reports/renamed.ts");
      rmSync(join(dir, "app/api/reports"), { recursive: true });
      await removed;
      await host.idle();
      expect(indexOf(dir)).not.toContain("'reports.renamed':");
      expect(existsSync(typeFile(dir, "app/api/reports"))).toBe(false);
    } finally {
      await server.close();
    }
    expect(host.active, "the Vite server close must dispose the watch").toBe(false);
    for (const event of ["add", "change", "unlink"]) expect(server.watcher.listenerCount(event)).toBe(0);
  }, 30_000);
});
