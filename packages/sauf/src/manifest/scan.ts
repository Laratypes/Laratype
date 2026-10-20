import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { emittedPaths, findEmitted, type ManifestKind } from "@laratype/support";
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

/** The config named `providers` (`app/config/providers.ts`, or `.mts`, `.js`, `.mjs`): the provider list, kept apart from the configs. */
export const PROVIDERS_NAME = "providers";

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
const isModule = (name: string) => isModuleFile(name, MODULE_EXTENSIONS);
/** A module's entry: `index.ts` (or `.mts`, `.js`, `.mjs`). */
const isModuleIndex = (name: string) => isModule(name) && stripExtension(name) === "index";

/** The module files of a folder (`modules`: each sub-folder's `index.*`), sorted by name. */
function scanDir(projectDir: string, dir: string, kind: ManifestKind, prefix = ""): ScannedEntry[] {
  const abs = join(projectDir, dir, prefix);
  if (!isDir(abs)) return [];
  const entries: ScannedEntry[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true }).sort(byName)) {
    if (kind === "modules") {
      if (!entry.isDirectory()) continue;
      for (const file of readdirSync(join(abs, entry.name)).sort().filter(isModuleIndex)) {
        entries.push({ name: entry.name, path: posix.join(dir, entry.name, file) });
      }
    } else if (entry.isDirectory() && NESTED.has(kind) && entry.name !== "node_modules") {
      entries.push(...scanDir(projectDir, dir, kind, posix.join(prefix, entry.name)));
    } else if (entry.isFile() && isModule(entry.name)) {
      entries.push({ name: posix.join(prefix, stripExtension(entry.name)), path: posix.join(dir, prefix, entry.name) });
    }
  }
  return entries;
}

/**
 * Reads the folders of `MANIFEST_DIRS` (file names only, never contents). Throws a `ManifestScanError` on a name found
 * twice in a kind: in both layouts, or `User.ts` next to `User.js`.
 */
export function scanManifest(projectDir: string): ScannedManifest {
  const kinds = {} as Record<ManifestKind, ScannedEntry[]>;
  for (const kind of Object.keys(MANIFEST_DIRS) as ManifestKind[]) {
    const entries: ScannedEntry[] = [];
    for (const dir of MANIFEST_DIRS[kind]) {
      for (const entry of scanDir(projectDir, dir, kind)) {
        // Lookups by name would pick one silently
        const other = entries.find((e) => e.name === entry.name);
        if (other) throw new ManifestScanError(`${kind}/${entry.name} is in both ${other.path} and ${entry.path}: rename or remove one`);
        entries.push(entry);
      }
    }
    kinds[kind] = entries;
  }
  const providers = kinds.configs.find((e) => e.name === PROVIDERS_NAME);
  kinds.configs = kinds.configs.filter((e) => e !== providers);
  return { providers, kinds };
}

/** Whether a project-relative file is one the scan reads: a module file where `MANIFEST_DIRS` look, at the depth they look. */
export function inManifestDirs(relativePath: string): boolean {
  const path = relativePath.replace(/\\/g, "/");
  const base = path.split("/").pop()!;
  return (Object.keys(MANIFEST_DIRS) as ManifestKind[]).some((kind) =>
    MANIFEST_DIRS[kind].some((dir) => {
      if (!path.startsWith(`${dir}/`)) return false;
      const depth = path.slice(dir.length + 1).split("/").length;
      if (kind === "modules") return depth === 2 && isModuleIndex(base);
      return (NESTED.has(kind) || depth === 1) && isModule(base);
    }),
  );
}

/**
 * Whether adding or deleting `file` (absolute) changes the manifest (`inManifestDirs`). `sauf dev --hmr` restarts on
 * it, and `laratype:manifest` invalidates its module. Editor temp files and helpers in sub-folders don't count.
 */
export function isManifestFile(projectDir: string, file: string): boolean {
  const rel = relative(projectDir, resolve(file));
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  return inManifestDirs(rel);
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

/** The empty manifest with the scan error (`AppManifest.error`): `appManifest()` throws it where the app is needed. */
export function emitManifestError(message: string): string {
  const kinds = (Object.keys(MANIFEST_DIRS) as ManifestKind[]).map((kind) => `  ${kind}: [],`);
  return lines([
    "// Generated by sauf (laratype:manifest): the scan failed. Do not edit.",
    "export default {",
    "  providers: undefined,",
    ...kinds,
    `  error: ${quote(message)},`,
    "};",
  ]);
}

/**
 * `dist/app.manifest.js` (`sauf build`): the manifest of the sources, pointing at what tsc emitted for them. Each file
 * is looked up with `findEmitted()`, the rule `getAppPath()` uses too: `dist/app/x.js` when tsc keeps the project tree
 * (`"rootDir": "."`, which an app importing `$api` needs), else `dist/x.js` (the 0.5 build, rooted at `app/`); both is a
 * stale dist. A source with no emitted file is an error that names the `include` entry it needs. Returns the written file.
 */
export function writeDistManifest(projectDir: string, distDir = "dist"): string {
  const dist = resolve(projectDir, distDir);
  const missing: string[] = [];
  const code = emitManifest(scanManifest(projectDir), (path) => {
    const found = findEmitted(dist, path);
    if (!found) {
      const include = `${path.split("/")[0]}/**/*`;
      missing.push(`${path} (looked for ${emittedPaths(path).map((file) => posix.join(distDir, file)).join(", ")}; tsconfig.build.json must include "${include}")`);
    }
    return `./${found ?? emittedPaths(path)[0]}`;
  });
  if (missing.length) {
    throw new Error(`sauf build: tsc emitted no file for ${missing.join("; ")}. An app that imports $api also needs "rootDir": "." in tsconfig.build.json`);
  }
  const target = join(dist, MANIFEST_FILE);
  writeFileSync(target, code);
  return target;
}
