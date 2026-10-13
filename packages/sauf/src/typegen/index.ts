import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import type * as TS from "typescript";
import { generateApiFile } from "./api";
import { emitTree } from "./emit";
import type { GeneratedFile } from "./emit";
import { scanTree } from "./scan";
import type { ContractTree } from "./scan";

export { ScanError, isTreeFile, listTreeFiles, scanFiles, scanTree } from "./scan";
export type { ContractTree, ScannedContract, ScannedFolder } from "./scan";
export { emitApiIndex, emitTree, emitTypesFile } from "./emit";
export type { EmitOptions, GeneratedFile } from "./emit";
export { ApiGenerationError, generateApiFile } from "./api";
export type { ApiFileOptions, ManifestEntry } from "./api";

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

const write = (projectDir: string, file: GeneratedFile) => {
  const target = join(projectDir, file.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.content);
};

/**
 * `sauf types:generate`: scans the contract tree, writes `<out>/types/**\/$types.d.ts` and `<out>/api/index.gen.ts`,
 * then type-checks them with the TS checker (no contract module runs) and writes the separate-repo `api.ts`.
 */
export async function generateTypes(options: GenerateOptions, ts?: typeof TS): Promise<GenerateResult> {
  const projectDir = resolve(options.projectDir);
  const root = posix.normalize((options.root ?? "app/api").replace(/\\/g, "/")).replace(/\/$/, "");
  const outDir = posix.normalize((options.outDir ?? ".laratype").replace(/\\/g, "/")).replace(/\/$/, "");
  const apiOut = (options.apiOut ?? posix.join(outDir, "api.ts")).replace(/\\/g, "/");
  const base = options.base ?? "/api";

  const tree = scanTree(join(projectDir, root), base);
  const files = emitTree(tree, { root, outDir });

  // $types.d.ts files of removed folders must not linger
  rmSync(join(projectDir, outDir, "types"), { recursive: true, force: true });
  for (const file of files) write(projectDir, file);

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
