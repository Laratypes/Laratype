import { existsSync, readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import { Console } from "@laratype/console";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import type { ManifestKind } from "@laratype/support";
import { lines, quote } from "../typegen/emit";
import { isModuleFile } from "../typegen/scan";
import { inside } from "../typegen/sync";

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

/** Every module extension: the provider list, module indexes and models. A declaration, test or spec file is never read. */
export const MODULE_EXTENSIONS = [".ts", ".mts", ".js", ".mjs"] as const;

/**
 * The extensions each kind reads: what the runtime discovery before the manifest loaded. Models came from a
 * `src/models/*` glob (any file); the others from `*.ts` files, plus `.mts`. A stray `helper.js` among the commands is
 * not loaded.
 */
export const KIND_EXTENSIONS: Readonly<Record<ManifestKind, readonly string[]>> = {
  configs: [".ts", ".mts"],
  routes: [".ts", ".mts"],
  commands: [".ts", ".mts"],
  models: MODULE_EXTENSIONS,
  migrations: [".ts", ".mts"],
  seeders: [".ts", ".mts"],
  factories: [".ts", ".mts"],
  modules: MODULE_EXTENSIONS,
};

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
/** Whether a file of `app/config` is read: the provider list with any module extension, a config as `.ts` / `.mts`. */
const isConfigFile = (name: string) =>
  stripExtension(name) === PROVIDERS_NAME ? isModuleFile(name, MODULE_EXTENSIONS) : isModuleFile(name, KIND_EXTENSIONS.configs);
/** Whether a file name is read for a kind (`modules`: a folder's index). */
const isKindFile = (kind: ManifestKind, name: string) => (kind === "configs" ? isConfigFile(name) : isModuleFile(name, KIND_EXTENSIONS[kind]));
/** A module's entry: `index.ts` (or `.mts`, `.js`, `.mjs`). */
const isModuleIndex = (name: string) => isModuleFile(name, MODULE_EXTENSIONS) && stripExtension(name) === "index";

/** What `scanManifest()` tracks: the project's real path, and the symlinks it did not follow. */
interface ScanContext {
  readonly root: string;
  readonly skipped: string[];
}

/** Whether a real path is the project or inside it. */
const inProject = (ctx: ScanContext, real: string) => real === ctx.root || inside(ctx.root, real);

/**
 * Whether an entry is a file or a folder. A symlink is followed (the glob of the runtime discovery followed them),
 * unless it leads outside the project: that one is skipped and reported. A dangling link is ignored.
 */
const kindOfEntry = (ctx: ScanContext, dir: string, entry: Dirent, rel: string): "file" | "dir" | undefined => {
  if (entry.isFile()) return "file";
  if (entry.isDirectory()) return "dir";
  if (!entry.isSymbolicLink()) return undefined;
  let real: string;
  try {
    real = realpathSync(join(dir, entry.name));
  } catch {
    return undefined;
  }
  if (!inProject(ctx, real)) {
    ctx.skipped.push(`${rel} (links outside the project)`);
    return undefined;
  }
  const stat = statSync(real);
  return stat.isFile() ? "file" : stat.isDirectory() ? "dir" : undefined;
};

/**
 * The module files of a folder (`modules`: each sub-folder's `index.*`), sorted by name. `ancestors` holds the real
 * paths of the folders being read, so a symlink back to one of them (a loop) is skipped and reported.
 */
function scanDir(ctx: ScanContext, projectDir: string, dir: string, kind: ManifestKind, prefix = "", ancestors: ReadonlySet<string> = new Set()): ScannedEntry[] {
  const abs = join(projectDir, dir, prefix);
  const rel = posix.join(dir, prefix);
  if (!isDir(abs)) return [];
  const real = realpathSync(abs);
  if (!inProject(ctx, real)) {
    ctx.skipped.push(`${rel} (links outside the project)`);
    return [];
  }
  if (ancestors.has(real)) {
    ctx.skipped.push(`${rel} (a symlink loop)`);
    return [];
  }
  const within = new Set([...ancestors, real]);
  const entries: ScannedEntry[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true }).sort(byName)) {
    const type = kindOfEntry(ctx, abs, entry, posix.join(rel, entry.name));
    if (kind === "modules") {
      if (type !== "dir") continue;
      for (const file of readdirSync(join(abs, entry.name)).sort().filter(isModuleIndex)) {
        entries.push({ name: entry.name, path: posix.join(dir, entry.name, file) });
      }
    } else if (type === "dir" && NESTED.has(kind) && entry.name !== "node_modules") {
      entries.push(...scanDir(ctx, projectDir, dir, kind, posix.join(prefix, entry.name), within));
    } else if (type === "file" && isKindFile(kind, entry.name)) {
      entries.push({ name: posix.join(prefix, stripExtension(entry.name)), path: posix.join(dir, prefix, entry.name) });
    }
  }
  return entries;
}

/** Each list of skipped symlinks once per process: `sauf dev` scans again on every load of the manifest. */
const warned = new Set<string>();

/**
 * Reads the folders of `MANIFEST_DIRS` (file names only, never contents). Throws a `ManifestScanError` on a name found
 * twice in a kind: in both layouts, or `User.ts` next to `User.js`. Symlinks that lead outside the project, or back to
 * a folder being read, are not followed: one warning lists them.
 */
export function scanManifest(projectDir: string): ScannedManifest {
  const ctx: ScanContext = { root: realpathSync(projectDir), skipped: [] };
  const kinds = {} as Record<ManifestKind, ScannedEntry[]>;
  for (const kind of Object.keys(MANIFEST_DIRS) as ManifestKind[]) {
    const entries: ScannedEntry[] = [];
    for (const dir of MANIFEST_DIRS[kind]) {
      for (const entry of scanDir(ctx, projectDir, dir, kind)) {
        // Lookups by name would pick one silently
        const other = entries.find((e) => e.name === entry.name);
        if (other) throw new ManifestScanError(`${kind}/${entry.name} is in both ${other.path} and ${entry.path}: rename or remove one`);
        entries.push(entry);
      }
    }
    kinds[kind] = entries;
  }
  if (ctx.skipped.length) {
    const message = `[laratype:manifest] symlinks not followed: ${ctx.skipped.join(", ")}`;
    if (!warned.has(message)) {
      warned.add(message);
      Console.warn(message);
    }
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
      return (NESTED.has(kind) || depth === 1) && isKindFile(kind, base);
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
 * in `dist`). `appDir` (production) is where the build put `app/`, relative to the manifest. Each line is its own
 * string: see `lines()` in typegen/emit.ts.
 */
export function emitManifest(scan: ScannedManifest, specifier: (path: string) => string, appDir?: string): string {
  const entry = (e: ScannedEntry) => `{ name: ${quote(e.name)}, path: ${quote(e.path)}, load: () => import(${quote(specifier(e.path))}) }`;
  const list = (entries: readonly ScannedEntry[]) => (entries.length ? `[\n${entries.map((e) => `    ${entry(e)},`).join("\n")}\n  ]` : "[]");
  const parts = [
    "// Generated by sauf (laratype:manifest, docs/v1/build.md › Plugin chain). Do not edit.",
    "export default {",
    `  providers: ${scan.providers ? entry(scan.providers) : "undefined"},`,
    ...(Object.keys(scan.kinds) as ManifestKind[]).map((kind) => `  ${kind}: ${list(scan.kinds[kind])},`),
    ...(appDir === undefined ? [] : [`  appDir: ${quote(appDir)},`]),
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
