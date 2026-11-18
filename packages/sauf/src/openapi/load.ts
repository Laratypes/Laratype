import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_OUT, ScanError, isolatedImport, resolveApiTree, syncContractTree } from "../typegen";
import { readApiTreeConfigOrDefaults } from "../typegen/config";
import { inside, slash } from "../typegen/sync";
import type { ApiTreeConfig } from "../typegen";
import { generateOpenApiDocument } from "./document";
import type { GeneratedOpenApi, OpenApiContract, OpenApiDocument } from "./document";
import { OpenApiGenerationError } from "./errors";
import { errorReason, isJsonObject } from "./schema";

/**
 * `sauf openapi:generate` (G3 #143): the same contract folder tree as `sauf types:generate`, written as an OpenAPI 3.1
 * document. No app boot (no `register()`, no provider, no database/auth env): the scan writes
 * `<gen>/api/index.gen.ts`, and that module and the project's own `@laratype/contract` are imported through jiti from
 * the project, so `sauf` needs no dependency on the contract package and the document uses the app's contract copy.
 */

const CONTRACT = "@laratype/contract";
const DEFAULT_OPENAPI = "openapi.json";

export type LoadFunction = (url: string) => Promise<unknown>;

/** The command's flags; each is a string when present (the wrapper validates the type). */
export interface OpenApiFlags {
  /** Contract tree root, relative to the project (default: config api.root, else app/api). */
  readonly root?: string;
  /** URL base of the root (default: config api.base, else /api). */
  readonly base?: string;
  /** The generated folder the scan writes and the index is read from (default .laratype). */
  readonly gen?: string;
  /** The document, a file inside the project (default openapi.json). */
  readonly out?: string;
}

export interface OpenApiProjectOptions extends OpenApiFlags {
  /** Project directory (absolute). */
  readonly projectDir: string;
  /** The module loader (default `isolatedImport`, jiti with no module cache); tests pass their own. */
  readonly load?: LoadFunction;
  /** The project's contract runtime, when the caller already holds it; otherwise it is loaded from the project. */
  readonly contract?: OpenApiContract;
}

export interface GeneratedOpenApiFile extends GeneratedOpenApi {
  /** The written document, relative to the project, with `/` separators. */
  readonly file: string;
  /** Whether the file changed; a second run leaves it untouched. */
  readonly changed: boolean;
}

/**
 * Scans the contract tree (no TS checker, no `api.ts`), imports the generated `appApi` and the project's
 * `@laratype/contract`, and writes the OpenAPI document. Throws `ScanError` for the tree/config, and
 * `OpenApiGenerationError` for a project without a resolvable contract package, an unloadable index, or an invalid
 * `--out`.
 */
export async function generateOpenApiFile(options: OpenApiProjectOptions): Promise<GeneratedOpenApiFile> {
  if (typeof options?.projectDir !== "string" || options.projectDir.trim() === "") {
    throw new OpenApiGenerationError("projectDir must be the project folder");
  }
  for (const [flag, value] of [
    ["root", options.root],
    ["base", options.base],
    ["gen", options.gen],
    ["out", options.out],
  ] as const) {
    if (value !== undefined && typeof value !== "string") {
      throw new OpenApiGenerationError(`--${flag} must be a string`);
    }
  }
  if (options.load !== undefined && typeof options.load !== "function") {
    throw new OpenApiGenerationError("load must be a module loader");
  }
  const projectDir = resolve(options.projectDir);
  const load = options.load ?? isolatedImport;
  const gen = slash(options.gen ?? DEFAULT_OUT);
  const out = slash(options.out ?? DEFAULT_OPENAPI);
  const warnings: string[] = [];

  checkOutputFile(projectDir, out);

  // Both flags: the config is not needed, so it is not imported (it may need env or providers), as in types:generate
  const config: ApiTreeConfig =
    options.root !== undefined && options.base !== undefined
      ? {}
      : await readApiTreeConfigOrDefaults(projectDir, (message) => warnings.push(message), load);
  const tree = resolveApiTree({ root: options.root, base: options.base }, config);
  const scan = syncContractTree({
    projectDir,
    root: tree.root,
    base: tree.base,
    outDir: gen,
    rootSource: tree.rootSource,
  });
  if (scan === undefined) {
    throw new ScanError(`the contract tree root "${tree.root}" does not exist (set it with --root or config api.root)`);
  }

  const contract = options.contract ?? (await loadContract(projectDir, load));
  const indexFile = slash(join(gen, "api", "index.gen.ts"));
  const index = await loadIndex(projectDir, indexFile, load);
  const appApi = isJsonObject(index) ? index.appApi : undefined;
  if (!contract.isApiRoot(appApi)) {
    throw new OpenApiGenerationError(`the generated appApi in ${indexFile} must be the root that defineApi returns`);
  }

  const metadata = readPackageMetadata(projectDir);
  const generated = generateOpenApiDocument(appApi, { contract, title: metadata.title, version: metadata.version });
  warnings.push(...generated.warnings);
  const changed = writeDocument(projectDir, out, generated.document);
  return { document: generated.document, warnings, file: out, changed };
}

/** `--out` is a file of its own inside the project: a command never writes outside it or over a directory. */
function checkOutputFile(projectDir: string, out: string): void {
  const target = resolve(projectDir, out);
  if (out === "" || isAbsolute(out) || /^[a-zA-Z]:/.test(out) || !inside(projectDir, target)) {
    throw new OpenApiGenerationError(`the output file "${out}" (--out) must be a file inside the project`);
  }
  if (existsSync(target) && statSync(target).isDirectory()) {
    throw new OpenApiGenerationError(`the output file "${out}" (--out) is a directory`);
  }
}

/**
 * The project's own `@laratype/contract`, resolved from the project root: the app has it (its contracts import it),
 * `sauf` deliberately does not depend on it. One clear error when it is missing, never a raw resolution stack.
 */
async function loadContract(projectDir: string, load: LoadFunction): Promise<OpenApiContract> {
  const require = createRequire(join(projectDir, "package.json"));
  let entry: string;
  try {
    entry = require.resolve(CONTRACT);
  } catch (error) {
    throw new OpenApiGenerationError(
      `the project at ${slash(projectDir)} has no resolvable ${CONTRACT} dependency: ` +
        "add it to the project's dependencies",
      { cause: error },
    );
  }
  let loaded: unknown;
  try {
    loaded = await load(pathToFileURL(entry).href);
  } catch (error) {
    throw new OpenApiGenerationError(
      `could not load ${CONTRACT} from ${slash(entry)}: ${oneLine(error)}`,
      { cause: error },
    );
  }
  const candidates = [loaded, isJsonObject(loaded) ? loaded.default : undefined];
  const contract = candidates.find(
    (candidate): candidate is OpenApiContract => isJsonObject(candidate) && typeof candidate.apiRoutes === "function",
  );
  if (contract === undefined || typeof contract.isApiRoot !== "function") {
    throw new OpenApiGenerationError(`${CONTRACT} (${slash(entry)}) does not export apiRoutes() and isApiRoot()`);
  }
  return contract;
}

/** The generated tree module, imported on its own (jiti): its contract modules must use resolvable specifiers. */
async function loadIndex(projectDir: string, indexFile: string, load: LoadFunction): Promise<unknown> {
  try {
    return await load(pathToFileURL(resolve(projectDir, indexFile)).href);
  } catch (error) {
    throw new OpenApiGenerationError(
      `could not load the generated appApi from ${indexFile}: ${oneLine(error)}`,
      { cause: error },
    );
  }
}

/** `info.title` / `info.version`: the project's package.json, else the documented defaults. */
function readPackageMetadata(projectDir: string): { readonly title: string; readonly version: string } {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
    if (isJsonObject(pkg)) {
      const name = typeof pkg.name === "string" && pkg.name.trim() !== "" ? pkg.name : "Laratype API";
      const version = typeof pkg.version === "string" && pkg.version.trim() !== "" ? pkg.version : "0.0.0";
      return { title: name, version };
    }
  } catch {
    // A missing or invalid package.json uses the defaults: the document does not depend on the app's metadata.
  }
  return { title: "Laratype API", version: "0.0.0" };
}

/** Writes the document only when its content changed, so a repeated run leaves the file (and its mtime) alone. */
function writeDocument(projectDir: string, out: string, document: OpenApiDocument): boolean {
  const content = `${JSON.stringify(document, null, 2)}\n`;
  const target = resolve(projectDir, out);
  if (existsSync(target) && readFileSync(target, "utf8") === content) return false;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return true;
}

/** One line, no stack: a jiti import failure prints its stack in the message of some errors. */
const oneLine = (error: unknown): string => errorReason(error).replace(/\s+/g, " ").trim() || "an unknown error";
