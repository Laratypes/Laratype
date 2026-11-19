import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { DEFAULT_BASE, DEFAULT_OUT, DEFAULT_ROOT } from "./config";
import { emitTree } from "./emit";
import type { GeneratedFile } from "./emit";
import { ScanError, scanTree } from "./scan";
import type { ContractTree } from "./scan";

/**
 * Writing the scanned tree: shared by `sauf types:generate` (`generateTypes`) and the dev scan behind `$api`
 * (`syncContractTree`, the `laratype:api` plugin).
 */

export interface GenerateOptions {
  /** Project directory (absolute). */
  readonly projectDir: string;
  /** Contract tree root, relative to the project. Default `app/api`. */
  readonly root?: string;
  /** URL base of the root. Default `/api`. */
  readonly base?: string;
  /** Output folder, relative to the project. Default `.laratype`. */
  readonly outDir?: string;
  /** The separate-repo `api.ts`, relative to the project. Default `<outDir>/api.ts`. */
  readonly apiOut?: string;
  /** tsconfig used to type-check the tree for `api.ts`. Default `tsconfig.json` in the project, when it exists. */
  readonly tsconfig?: string;
  /** Where `root` came from (`--root`, `config api.root`), named by the "outside the project" error. */
  readonly rootSource?: string;
}

export interface GenerateResult {
  readonly tree: ContractTree;
  /** Every written file, relative to the project. */
  readonly files: readonly GeneratedFile[];
}

export interface SyncResult extends GenerateResult {
  /** The files this run wrote or deleted, relative to the project; empty when the tree did not change. */
  readonly changed: readonly string[];
}

/** Whether `child` is strictly inside `parent` (both absolute). */
export const inside = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/** `--out` must be a folder of its own inside the project, apart from the tree it describes. */
function checkOutDir(projectDir: string, root: string, outDir: string) {
  const out = resolve(projectDir, outDir);
  const rootDir = resolve(projectDir, root);
  if (!inside(projectDir, out)) throw new ScanError(`the output folder "${outDir}" (--out, or the dev plugin's outDir) must be a folder inside the project, not the project itself or outside it`);
  if (out === rootDir || inside(out, rootDir)) throw new ScanError(`the output folder "${outDir}" must not contain the contract tree root "${root}" (--root or config api.root)`);
}

/**
 * Removes the `$types.d.ts` files under `typesDir` that this run does not rewrite (a deleted folder), then the folders
 * left empty. Nothing else is touched, so other files under `--out` survive.
 */
function removeStaleTypes(typesDir: string, keep: ReadonlySet<string>): string[] {
  const removed: string[] = [];
  if (!existsSync(typesDir)) return removed;
  const walk = (dir: string): boolean => {
    let empty = true;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (walk(path)) rmdirSync(path);
        else empty = false;
      } else if (entry.isFile() && entry.name === "$types.d.ts" && !keep.has(resolve(path))) {
        rmSync(path);
        removed.push(path);
      } else {
        empty = false;
      }
    }
    return empty;
  };
  walk(typesDir);
  return removed;
}

/** The nearest existing path at or above `target` (a link itself included), so its realpath can be resolved. */
function nearestExisting(target: string): string | undefined {
  for (let current = target; ; current = dirname(current)) {
    try {
      lstatSync(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (dirname(current) === current) return undefined;
  }
}

/**
 * Refuses a write or delete through a junction or symlink that leaves the project: the nearest existing parent of
 * `target`, realpath-resolved, must stay inside `projectReal`. One `ScanError` names the path; a caller that checks
 * every target first writes nothing at all. The realpath also catches a link whose name still looks inside the project.
 */
function checkOutputPath(projectReal: string, projectDir: string, target: string): void {
  const existing = nearestExisting(target);
  let real: string | undefined;
  if (existing !== undefined) {
    try {
      real = realpathSync(existing);
    } catch {
      // A broken link: it cannot be proven to stay inside, so it is refused like one that leaves.
    }
  }
  if (real !== undefined && (real === projectReal || inside(projectReal, real))) return;
  const rel = slash(relative(projectDir, target));
  const found = real === undefined ? "" : ` ("${real}")`;
  throw new ScanError(`the output path "${rel}" resolves outside the project${found}: a junction or symlink under the output folder must stay inside it`);
}

/** Writes a file only when its content differs, so an unchanged tree touches nothing (no watcher event). */
export const writeGenerated = (projectDir: string, file: GeneratedFile): boolean => {
  const target = join(projectDir, file.path);
  checkOutputPath(realpathSync(projectDir), projectDir, target);
  if (existsSync(target) && readFileSync(target, "utf8") === file.content) return false;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content);
  return true;
};

/** A posix path: backslashes become `/`, no trailing `/` (what Vite's `normalizePath` gives for module ids). */
export const slash = (path: string) => posix.normalize(path.replace(/\\/g, "/")).replace(/\/$/, "");

export interface TreePaths {
  readonly projectDir: string;
  readonly root: string;
  readonly outDir: string;
  readonly base: string;
}

/** The normalized project folder, root, output folder and base; throws on an invalid `--out`. */
export const resolveTreePaths = (options: GenerateOptions): TreePaths => {
  const projectDir = resolve(options.projectDir);
  const root = slash(options.root ?? DEFAULT_ROOT);
  const outDir = slash(options.outDir ?? DEFAULT_OUT);
  // A relative folder inside the project, or the project itself (`.`): emit uses the root as a path segment, so an
  // absolute root (a drive letter included) is rejected even when it points inside
  const rootDir = resolve(projectDir, root);
  if (isAbsolute(root) || /^[a-zA-Z]:/.test(root) || (rootDir !== projectDir && !inside(projectDir, rootDir))) {
    throw new ScanError(`the contract tree root "${root}"${options.rootSource ? ` (${options.rootSource})` : ""} must be a folder inside the project`);
  }
  checkOutDir(projectDir, root, outDir);
  return { projectDir, root, outDir, base: options.base ?? DEFAULT_BASE };
};

/** Scans the tree and writes `<out>/types/**\/$types.d.ts` and `<out>/api/index.gen.ts` when their content changed. */
export function writeTree({ projectDir, root, outDir, base }: TreePaths): SyncResult {
  // With `--root .` the output folder is inside the root: its generated files are not contracts
  const tree = scanTree(resolve(projectDir, root), base, [resolve(projectDir, outDir)]);
  const files = emitTree(tree, { root, outDir });
  // Check the types folder and every target before any write or stale-file delete, so a junction or symlink planted
  // under the output folder that points outside the project is refused with one diagnostic and nothing is touched.
  const projectReal = realpathSync(projectDir);
  const typesDir = join(projectDir, outDir, "types");
  checkOutputPath(projectReal, projectDir, typesDir);
  for (const file of files) checkOutputPath(projectReal, projectDir, join(projectDir, file.path));
  // $types.d.ts files of removed folders must not linger
  const removed = removeStaleTypes(typesDir, new Set(files.map((f) => resolve(projectDir, f.path))));
  const written = files.filter((file) => writeGenerated(projectDir, file)).map((file) => file.path);
  return { tree, files, changed: [...written, ...removed.map((p) => slash(relative(projectDir, p)))] };
}

/**
 * The server's dev scan (docs/v1/http.md › Router v2): the same scan and files as `sauf types:generate`,
 * without the TS checker and `api.ts`. Returns `undefined` when the root folder does not exist.
 */
export function syncContractTree(options: GenerateOptions): SyncResult | undefined {
  const paths = resolveTreePaths(options);
  if (!existsSync(resolve(paths.projectDir, paths.root))) return undefined;
  return writeTree(paths);
}
