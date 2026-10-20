import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Scan of the contract folder tree (docs/v1/contract.md › Contract folder tree). It reads file and folder
 * names only, never file contents, so it can run on every add, rename and delete.
 *
 * - `users.ts` and `users/index.ts` are the same contract (`/api/users`, `users`); having both is an error.
 * - A `[x]` folder is the path param `:x` and is dropped from names.
 * - `_scope.ts` is the scope of its folder and every folder below it.
 * - `*.d.ts`, `*.test.ts`, `*.spec.ts` and names starting with `_` or `$` are not contracts.
 */

/** Paths are relative to the scan root, with `/` separators: `users/[user]/posts.ts`. */
export interface ScannedContract {
  /** Tree name: `users.posts`. */
  readonly name: string;
  readonly file: string;
  /** Folder of the file: `users/[user]` (`""` for the root). */
  readonly dir: string;
  /** Full URL prefix: `/api/users/:user/posts`. */
  readonly path: string;
  /** Scope files from outer to inner, the contract's own folder included. */
  readonly scopes: readonly string[];
}

export interface ScannedFolder {
  readonly dir: string;
  /** Folder URL: `/api/users/:user`. */
  readonly path: string;
  /** This folder's `_scope.ts`, if any. */
  readonly scope: string | undefined;
  /** Scope files of the outer folders, outer to inner (this folder's own scope excluded). */
  readonly outerScopes: readonly string[];
}

export interface ContractTree {
  /** Sorted by tree name. */
  readonly contracts: readonly ScannedContract[];
  /** Folders that hold a contract or a scope, sorted by path. */
  readonly folders: readonly ScannedFolder[];
}

export class ScanError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    // No prefix: `sauf types:generate` prints `[sauf types:generate] `, the dev scan `[laratype:api] `
    super(message, options);
    this.name = "ScanError";
  }
}

const SCOPE_FILE = "_scope.ts";
const PARAM = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** The URL base of the root: `""` or a path that starts with `/` and does not end with `/`. Shared by the scan and config `api.base`. */
export function checkBase(base: unknown, label: string): asserts base is string {
  if (typeof base !== "string" || (base !== "" && (!base.startsWith("/") || base.endsWith("/")))) {
    throw new ScanError(`${label} must be "" or a path that starts with "/" and does not end with "/", such as "/api"`);
  }
}

const isPrivate = (name: string) => name.startsWith("_") || name.startsWith("$");

/**
 * A module file name with one of `extensions` that is no declaration, test or spec file. Shared by the contract tree
 * (`.ts` only) and the app manifest.
 */
export const isModuleFile = (base: string, extensions: readonly string[] = [".ts"]): boolean =>
  extensions.some((ext) => base.endsWith(ext)) && !/\.(d|test|spec)\.[cm]?[jt]s$/.test(base);

/** Whether a root-relative file takes part in the tree: a contract or a scope. */
export const isTreeFile = (file: string): boolean => {
  const parts = file.split("/");
  const base = parts[parts.length - 1]!;
  if (parts.slice(0, -1).some((part) => isPrivate(part) || part === "node_modules")) return false;
  if (base === SCOPE_FILE) return true;
  return isModuleFile(base) && !isPrivate(base);
};

interface Segment {
  name: string | undefined;
  url: string;
}

/** `users` → name `users`, URL `/users`; `[user]` → no name, URL `/:user`. */
const folderSegment = (folder: string, dir: string): Segment => {
  if (folder.startsWith("[")) {
    const param = PARAM.exec(folder);
    if (!param) throw new ScanError(`${dir}: "${folder}" is not a valid param folder: use [name]; optional and rest param folders are not supported`);
    return { name: undefined, url: `/:${param[1]}` };
  }
  if (!SEGMENT.test(folder)) throw new ScanError(`${dir}: folder name "${folder}" may only use letters, digits, "_" and "-"`);
  return { name: folder, url: `/${folder}` };
};

const join2 = (a: string, b: string) => (a ? `${a}/${b}` : b);

/** Builds the tree from root-relative file paths (any order). Throws a ScanError on an invalid tree. */
export function scanFiles(files: readonly string[], base: string): ContractTree {
  checkBase(base, `base "${base}"`);
  const treeFiles = files.map((f) => f.replace(/\\/g, "/")).filter(isTreeFile).sort();
  const scopeDirs = new Set(treeFiles.filter((f) => f === SCOPE_FILE || f.endsWith(`/${SCOPE_FILE}`)).map((f) => f.slice(0, -SCOPE_FILE.length - 1)));

  const folderInfo = (dir: string) => {
    const names: string[] = [];
    let url = base;
    const scopes: string[] = scopeDirs.has("") ? [SCOPE_FILE] : [];
    let current = "";
    for (const folder of dir ? dir.split("/") : []) {
      current = join2(current, folder);
      const seg = folderSegment(folder, current);
      if (seg.name) names.push(seg.name);
      url += seg.url;
      if (scopeDirs.has(current)) scopes.push(join2(current, SCOPE_FILE));
    }
    return { names, url, scopes };
  };

  const contracts: ScannedContract[] = [];
  const byName = new Map<string, ScannedContract>();
  const folderDirs = new Set(scopeDirs);

  for (const file of treeFiles) {
    const slash = file.lastIndexOf("/");
    const dir = slash === -1 ? "" : file.slice(0, slash);
    const base_ = file.slice(slash + 1);
    if (base_ === SCOPE_FILE) continue;
    const stem = base_.slice(0, -".ts".length);
    const info = folderInfo(dir);
    let names = info.names;
    let path = info.url;
    if (stem !== "index") {
      if (!SEGMENT.test(stem)) throw new ScanError(`${file}: file name "${stem}" may only use letters, digits, "_" and "-" (use a [x] folder for params)`);
      names = [...names, stem];
      path += `/${stem}`;
    }
    if (names.length === 0) throw new ScanError(`${file}: a contract needs a name; put it in a named folder (the root index.ts has none)`);
    const name = names.join(".");
    const contract: ScannedContract = { name, file, dir, path: path || "/", scopes: info.scopes };
    const other = byName.get(name);
    if (other) {
      const same = other.path === contract.path;
      throw new ScanError(
        same
          ? `${other.file} and ${file} are the same contract (${path}): keep one`
          : `${other.file} and ${file} have the same name "${name}" ([x] folders are dropped from names)`,
      );
    }
    byName.set(name, contract);
    contracts.push(contract);
    folderDirs.add(dir);
  }

  const folders: ScannedFolder[] = [...folderDirs].sort().map((dir) => {
    const info = folderInfo(dir);
    const scope = scopeDirs.has(dir) ? join2(dir, SCOPE_FILE) : undefined;
    return { dir, path: info.url, scope, outerScopes: scope ? info.scopes.slice(0, -1) : info.scopes };
  });

  return { contracts: contracts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)), folders };
}

/**
 * Lists the files under `rootDir` (root-relative, `/` separators). Private folders (`_x`, `$x`), `node_modules` and
 * the `skip` folders (absolute: the output folder when it is inside the root) are skipped.
 */
export function listTreeFiles(rootDir: string, skip: readonly string[] = []): string[] {
  const out: string[] = [];
  const skipped = new Set(skip.map((dir) => resolve(dir)));
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relPath = join2(rel, entry.name);
      if (entry.isDirectory()) {
        if (!isPrivate(entry.name) && entry.name !== "node_modules" && !skipped.has(resolve(dir, entry.name))) walk(join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        out.push(relPath);
      }
    }
  };
  walk(rootDir, "");
  return out;
}

export const scanTree = (rootDir: string, base: string, skip: readonly string[] = []): ContractTree => scanFiles(listTreeFiles(rootDir, skip), base);
