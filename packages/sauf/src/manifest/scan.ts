import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { emittedPaths, type ManifestKind } from "@laratype/support";
import { lines, quote } from "../typegen/emit";
import { isModuleFile } from "../typegen/scan";
import { MANIFEST_FILE } from "./load";

/**
 * The app manifest's discovery (docs/v1/build.md › Plugin chain): which folders hold which kind of module. Both
 * layouts are read, the 0.5 one (`app/src/...`, `app/database/...`) first, then the v1 one of docs/v1/overview.md ›
 * Project structure. A folder that does not exist is skipped; a kind found in both is loaded from both, but one name
 * in both is a scan error.
 */
export const MANIFEST_DIRS: Readonly<Record<ManifestKind, readonly string[]>> = {
  configs: ["app/config"],
  routes: ["app/routes"],
  commands: ["app/src/console/commands", "app/console/commands"],
  models: ["app/src/models", "app/models"],
  migrations: ["app/database/migrations", "database/migrations"],
  seeders: ["app/database/seeders", "database/seeders"],
  factories: ["app/database/factories", "database/factories"],
  modules: ["app/modules"],
};

/** The kinds read with their sub-folders, named by their path in the folder (`Admin/UserSeeder`, as `db:seed --class` takes it). */
const NESTED: ReadonlySet<ManifestKind> = new Set(["seeders"]);

/** The module extensions read; a declaration, test or spec file is skipped. */
export const MODULE_EXTENSIONS = [".ts", ".mts", ".js", ".mjs"] as const;

/** `app/config/providers.ts`: the provider list, kept apart from the configs. */
export const PROVIDERS_FILE = "app/config/providers.ts";

/** A discovered file: its name and its path relative to the project, with `/` separators. */
export interface ScannedEntry {
  readonly name: string;
  readonly path: string;
}

export interface ScannedManifest {
  readonly providers?: ScannedEntry;
  readonly kinds: Readonly<Record<ManifestKind, readonly ScannedEntry[]>>;
}

/** Two files of one kind with the same name, one per layout. */
export class ManifestScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestScanError";
  }
}

const isDir = (path: string) => existsSync(path) && statSync(path).isDirectory();
const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const stripExtension = (name: string) => name.replace(/\.[cm]?[jt]s$/, "");

/** The module files of a folder (`modules`: each sub-folder's `index.ts`), sorted by name. */
function scanDir(projectDir: string, dir: string, kind: ManifestKind, prefix = ""): ScannedEntry[] {
  const abs = join(projectDir, dir, prefix);
  if (!isDir(abs)) return [];
  const entries: ScannedEntry[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true }).sort(byName)) {
    if (kind === "modules") {
      if (entry.isDirectory() && existsSync(join(abs, entry.name, "index.ts"))) {
        entries.push({ name: entry.name, path: posix.join(dir, entry.name, "index.ts") });
      }
    } else if (entry.isDirectory() && NESTED.has(kind) && entry.name !== "node_modules") {
      entries.push(...scanDir(projectDir, dir, kind, posix.join(prefix, entry.name)));
    } else if (entry.isFile() && isModuleFile(entry.name, MODULE_EXTENSIONS)) {
      const path = posix.join(dir, prefix, entry.name);
      if (path !== PROVIDERS_FILE) entries.push({ name: posix.join(prefix, stripExtension(entry.name)), path });
    }
  }
  return entries;
}

/** Reads the folders of `MANIFEST_DIRS` (file names only, never contents). Throws a `ManifestScanError` on a duplicate name. */
export function scanManifest(projectDir: string): ScannedManifest {
  const kinds = {} as Record<ManifestKind, ScannedEntry[]>;
  for (const kind of Object.keys(MANIFEST_DIRS) as ManifestKind[]) {
    const entries: ScannedEntry[] = [];
    for (const dir of MANIFEST_DIRS[kind]) {
      for (const entry of scanDir(projectDir, dir, kind)) {
        // `models/User` in both layouts, or `User.ts` next to `User.js`: lookups by name would pick one silently
        const other = entries.find((e) => e.name === entry.name);
        if (other) throw new ManifestScanError(`${kind}/${entry.name} is in both ${other.path} and ${entry.path}: rename or remove one`);
        entries.push(entry);
      }
    }
    kinds[kind] = entries;
  }
  const providers = existsSync(join(projectDir, PROVIDERS_FILE)) ? { name: "providers", path: PROVIDERS_FILE } : undefined;
  return { providers, kinds };
}

/** Whether a file of the project (relative path) sits in one of `MANIFEST_DIRS`. */
export function inManifestDirs(relativePath: string): boolean {
  const path = relativePath.replace(/\\/g, "/");
  return Object.values(MANIFEST_DIRS).some((dirs) => dirs.some((dir) => path.startsWith(`${dir}/`)));
}

/**
 * Whether adding or deleting `file` (absolute) changes the manifest: a module file in one of `MANIFEST_DIRS`. `sauf dev
 * --hmr` restarts on it, and `laratype:manifest` invalidates its module. Editor temp files don't count.
 */
export function isManifestFile(projectDir: string, file: string): boolean {
  const rel = relative(projectDir, resolve(file));
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  const base = rel.replace(/\\/g, "/").split("/").pop()!;
  return inManifestDirs(rel) && isModuleFile(base, MODULE_EXTENSIONS);
}

/**
 * The manifest module: one lazy loader per entry, each a literal `import()` so a bundler still sees every module.
 * `specifier` maps a project-relative source path to what the module imports (an absolute file in dev, `./app/x.js`
 * in `dist`). Each line is its own string: see `lines()` in typegen/emit.ts.
 */
export function emitManifest(scan: ScannedManifest, specifier: (path: string) => string): string {
  const entry = (e: ScannedEntry) => `{ name: ${quote(e.name)}, path: ${quote(e.path)}, load: () => import(${quote(specifier(e.path))}) }`;
  const list = (entries: readonly ScannedEntry[]) => (entries.length ? `[\n${entries.map((e) => `    ${entry(e)},`).join("\n")}\n  ]` : "[]");
  const parts = [
    "// Generated by sauf (laratype:manifest, docs/v1/build.md › Plugin chain). Do not edit.",
    "export default {",
    `  providers: ${scan.providers ? entry(scan.providers) : "undefined"},`,
    ...(Object.keys(scan.kinds) as ManifestKind[]).map((kind) => `  ${kind}: ${list(scan.kinds[kind])},`),
    "};",
  ];
  return lines(parts);
}

/**
 * `dist/app.manifest.js` (`sauf build`): the manifest of the sources, pointing at what tsc emitted for them. Each file
 * is looked up with `emittedPaths()`, the rule `getAppPath()` uses too: `dist/app/x.js` when tsc keeps the project tree
 * (`"rootDir": "."`, which an app importing `$api` needs), else `dist/x.js` (the 0.5 build, rooted at `app/`). A source
 * with no emitted file is an error that names the `include` entry it needs. Returns the written file.
 */
export function writeDistManifest(projectDir: string, distDir = "dist"): string {
  const missing: string[] = [];
  const code = emitManifest(scanManifest(projectDir), (path) => {
    const candidates = emittedPaths(path);
    const found = candidates.find((file) => existsSync(join(projectDir, distDir, file)));
    if (!found) {
      const include = `${path.split("/")[0]}/**/*`;
      missing.push(`${path} (looked for ${candidates.map((file) => posix.join(distDir, file)).join(", ")}; tsconfig.build.json must include "${include}")`);
    }
    return `./${found ?? candidates[0]}`;
  });
  if (missing.length) {
    throw new Error(`sauf build: tsc emitted no file for ${missing.join("; ")}. An app that imports $api also needs "rootDir": "." in tsconfig.build.json`);
  }
  const target = join(projectDir, distDir, MANIFEST_FILE);
  writeFileSync(target, code);
  return target;
}
