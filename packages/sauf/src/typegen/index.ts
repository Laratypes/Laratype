import { existsSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import type * as TS from "typescript";
import { generateApiFile } from "./api";
import { ScanError } from "./scan";
import { resolveTreePaths, slash, writeGenerated, writeTree } from "./sync";
import type { GenerateOptions, GenerateResult } from "./sync";

export { ScanError, isTreeFile, listTreeFiles, scanFiles, scanTree } from "./scan";
export type { ContractTree, ScannedContract, ScannedFolder } from "./scan";
export { emitApiIndex, emitTree, emitTypesFile } from "./emit";
export type { EmitOptions, GeneratedFile } from "./emit";
export { ApiGenerationError, generateApiFile } from "./api";
export type { ApiFileOptions, ManifestEntry } from "./api";
export { DEFAULT_BASE, DEFAULT_OUT, DEFAULT_ROOT, apiTreeConfig, isolatedImport, readApiTreeConfig, resolveApiTree } from "./config";
export type { ApiTreeConfig } from "./config";
export { syncContractTree } from "./sync";
export type { GenerateOptions, GenerateResult, SyncResult } from "./sync";
export { API_ALIAS, API_PLUGIN_NAME, laratypeApi, contractTreePlugin } from "./plugin";
export type { ApiPluginApi, ApiPluginOptions } from "./plugin";

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

/**
 * `sauf types:generate`: scans the contract tree, writes `<out>/types/**\/$types.d.ts` and `<out>/api/index.gen.ts`,
 * then type-checks them with the TS checker (no contract module runs) and writes the separate-repo `api.ts`.
 */
export async function generateTypes(options: GenerateOptions, ts?: typeof TS): Promise<GenerateResult> {
  const paths = resolveTreePaths(options);
  const { projectDir, root, outDir } = paths;
  const apiOut = slash(options.apiOut ?? posix.join(outDir, "api.ts"));
  if (!existsSync(resolve(projectDir, root))) throw new ScanError(`the contract tree root "${root}" does not exist (set it with --root or config api.root)`);
  const { tree, files } = writeTree(paths);

  const tsconfig = options.tsconfig ? resolve(projectDir, options.tsconfig) : join(projectDir, "tsconfig.json");
  const api = generateApiFile(ts ?? (await loadTypeScript()), {
    projectDir,
    tsconfig: existsSync(tsconfig) ? tsconfig : undefined,
    indexFile: join(projectDir, outDir, "api", "index.gen.ts"),
    typesDir: join(projectDir, outDir, "types"),
    outFile: apiOut,
  });
  writeGenerated(projectDir, api);
  return { tree, files: [...files, { path: api.path, content: api.content }] };
}
