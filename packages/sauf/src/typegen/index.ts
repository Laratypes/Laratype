import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import type * as TS from "typescript";
import { generateApiFile } from "./api";
import { emitTree } from "./emit";
import type { GeneratedFile } from "./emit";
import { ScanError, scanTree } from "./scan";
import type { ContractTree } from "./scan";
import { DEFAULT_BASE, DEFAULT_ROOT } from "./config";

export { ScanError, isTreeFile, listTreeFiles, scanFiles, scanTree } from "./scan";
export type { ContractTree, ScannedContract, ScannedFolder } from "./scan";
export { emitApiIndex, emitTree, emitTypesFile } from "./emit";
export type { EmitOptions, GeneratedFile } from "./emit";
export { ApiGenerationError, generateApiFile } from "./api";
export type { ApiFileOptions, ManifestEntry } from "./api";
export { DEFAULT_BASE, DEFAULT_ROOT, apiTreeConfig, readApiTreeConfig, resolveApiTree } from "./config";
export type { ApiTreeConfig } from "./config";
export { API_ALIAS, API_PLUGIN_NAME, laratypeApi, rescanContractTree } from "./plugin";
export type { ApiPluginApi, ApiPluginOptions } from "./plugin";

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
}

export interface GenerateResult {
  readonly tree: ContractTree;
  /** Every written file, relative to the project. */
  readonly files: readonly GeneratedFile[];
}

export class TypeScriptMissingError extends Error {
  constructor(cause: unknown) {
    super("[sauf types:generate] sauf types:generate needs the typescript package (>=5): add it to the project's devDependencies");
    this.name = "TypeScriptMissingError";
    this.cause = cause;
  }
}

/** Loads `typescript` only when types:generate runs, so `sauf dev` and app boot never pull it in. */
export async function loadTypeScript(load: () => Promise<unknown> = () => import("typescript")): Promise<typeof TS> {
  try {
    const mod = (await load()) as typeof TS & { default?: typeof TS };
    return mod.default ?? mod;
  } catch (error) {
    throw new TypeScriptMissingError(error);
  }
}

const inside = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/** `--out` must be a folder of its own inside the project, apart from the tree it describes. */
function checkOutDir(projectDir: string, root: string, outDir: string) {
  const out = resolve(projectDir, outDir);
  const rootDir = resolve(projectDir, root);
  if (!inside(projectDir, out)) throw new ScanError(`--out "${outDir}" must be a folder inside the project, not the project itself or outside it`);
  if (out === rootDir || inside(out, rootDir)) throw new ScanError(`--out "${outDir}" must not contain the contract tree root "${root}"`);
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

/** Writes a file only when its content differs, so an unchanged tree touches nothing (no watcher event). */
const write = (projectDir: string, file: GeneratedFile): boolean => {
  const target = join(projectDir, file.path);
  if (existsSync(target) && readFileSync(target, "utf8") === file.content) return false;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content);
  return true;
};

const slash = (path: string) => posix.normalize(path.replace(/\\/g, "/")).replace(/\/$/, "");

const paths = (options: GenerateOptions) => {
  const projectDir = resolve(options.projectDir);
  const root = slash(options.root ?? DEFAULT_ROOT);
  const outDir = slash(options.outDir ?? ".laratype");
  checkOutDir(projectDir, root, outDir);
  return { projectDir, root, outDir, base: options.base ?? DEFAULT_BASE };
};

export interface SyncResult extends GenerateResult {
  /** The files this run wrote or deleted, relative to the project; empty when the tree did not change. */
  readonly changed: readonly string[];
}

/** Scans the tree and writes `<out>/types/**\/$types.d.ts` and `<out>/api/index.gen.ts` when their content changed. */
function writeTree(options: GenerateOptions): SyncResult {
  const { projectDir, root, outDir, base } = paths(options);
  const tree = scanTree(join(projectDir, root), base);
  const files = emitTree(tree, { root, outDir });
  // $types.d.ts files of removed folders must not linger
  const removed = removeStaleTypes(join(projectDir, outDir, "types"), new Set(files.map((f) => resolve(projectDir, f.path))));
  const written = files.filter((file) => write(projectDir, file)).map((file) => file.path);
  return { tree, files, changed: [...written, ...removed.map((p) => relative(projectDir, p).replace(/\\/g, "/"))] };
}

/**
 * The server's dev startup scan (docs/v1/http.md › Router v2): the same scan and files as `sauf types:generate`,
 * without the TS checker and `api.ts`. Returns `undefined` when the root folder does not exist, so an app
 * without a contract tree still boots. Rescanning on change is G2 #142.
 */
export function syncContractTree(options: GenerateOptions): SyncResult | undefined {
  const { projectDir, root } = paths(options);
  if (!existsSync(join(projectDir, root))) return undefined;
  return writeTree(options);
}

/**
 * `sauf types:generate`: scans the contract tree, writes `<out>/types/**\/$types.d.ts` and `<out>/api/index.gen.ts`,
 * then type-checks them with the TS checker (no contract module runs) and writes the separate-repo `api.ts`.
 */
export async function generateTypes(options: GenerateOptions, ts?: typeof TS): Promise<GenerateResult> {
  const { projectDir, root, outDir } = paths(options);
  const apiOut = (options.apiOut ?? posix.join(outDir, "api.ts")).replace(/\\/g, "/");
  if (!existsSync(join(projectDir, root))) throw new ScanError(`the contract tree root "${root}" does not exist (set it with --root or config api.root)`);
  const { tree, files } = writeTree(options);

  const tsconfig = options.tsconfig ? resolve(projectDir, options.tsconfig) : join(projectDir, "tsconfig.json");
  const api = generateApiFile(ts ?? (await loadTypeScript()), {
    projectDir,
    tsconfig: existsSync(tsconfig) ? tsconfig : undefined,
    indexFile: join(projectDir, outDir, "api", "index.gen.ts"),
    typesDir: join(projectDir, outDir, "types"),
    outFile: apiOut,
  });
  write(projectDir, api);
  return { tree, files: [...files, { path: api.path, content: api.content }] };
}
