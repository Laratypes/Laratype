import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createJiti } from "jiti";
import { loadEnv } from "@laratype/support";
import { ScanError, checkBase } from "./scan";

/**
 * `app/config/config.ts` itself could not be imported (an alias, a module needing Vite transforms, a `$api` import).
 * `sauf types:generate` falls back to its flags and the defaults on it; an `api` key that loads but is invalid is a
 * plain `ScanError`.
 */
export class ConfigImportError extends ScanError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigImportError";
  }
}

/**
 * Where the contract tree lives: config `api.root` / `api.base` (docs/v1/contract.md › Contract folder tree › Root).
 * `sauf types:generate` and the server's dev scan read the same value; the `--root` / `--base` flags override it.
 */
export interface ApiTreeConfig {
  /** Contract tree root, relative to the project. Default `app/api`. */
  readonly root?: string;
  /** URL base of the root. Default `/api`. */
  readonly base?: string;
}

export const DEFAULT_ROOT = "app/api";
export const DEFAULT_BASE = "/api";
/** The generated folder: `$types.d.ts` files and `api/index.gen.ts`. */
export const DEFAULT_OUT = ".laratype";

/** Checks the `api` key of a config object; a missing key is `{}`. */
export function apiTreeConfig(config: unknown): ApiTreeConfig {
  const api = (config as { api?: unknown } | null | undefined)?.api;
  if (api === undefined) return {};
  if (typeof api !== "object" || api === null) throw new ScanError("config api must be { root?, base? }");
  const { root, base } = api as Record<string, unknown>;
  if (root !== undefined && (typeof root !== "string" || root === "")) throw new ScanError("config api.root must be a folder, relative to the project");
  if (base !== undefined) checkBase(base, "config api.base");
  return { root: root as string | undefined, base: base as string | undefined };
}

/**
 * Imports a config file outside the app's module graph: a jiti instance with no module cache. The Vite SSR cache is
 * not touched, so the app's own later import of the file evaluates it fresh (after `EnvLoadServiceProvider`), and a
 * config that imports a module still loading up the app's import chain can't deadlock the scan.
 */
export const isolatedImport = (url: string): Promise<unknown> => {
  const file = fileURLToPath(url);
  // No module cache (a fresh evaluation each time); the transpile cache stays, so rescans don't re-transpile the graph
  return createJiti(file, { moduleCache: false }).import(file);
};

/**
 * Reads `api` from `app/config/config.ts` by importing that file only, in isolation (`isolatedImport`): no provider
 * boots, so no database or auth is needed. The project's env file is loaded first (`loadEnv`, as
 * `EnvLoadServiceProvider` does), so `Env.get()` in the config sees it. A project without the file uses the defaults.
 */
export async function readApiTreeConfig(projectDir: string, load: (url: string) => Promise<unknown> = isolatedImport): Promise<ApiTreeConfig> {
  const file = join(projectDir, "app", "config", "config.ts");
  if (!existsSync(file)) return {};
  loadEnv(projectDir);
  let mod: { default?: unknown } | undefined;
  try {
    mod = (await load(pathToFileURL(file).href)) as { default?: unknown } | undefined;
  } catch (error) {
    // `$api` is generated from the tree this config locates, so the config cannot import it
    if (/Cannot find (module|package) ['"]\$api['"]/.test(String((error as Error)?.message ?? error))) {
      throw new ConfigImportError("app/config/config.ts must not import $api (directly or indirectly)", { cause: error });
    }
    // Imported on its own, the config knows no Vite or tsconfig `paths` alias: name the file the error comes from
    throw new ConfigImportError(`app/config/config.ts could not be imported on its own (no Vite or tsconfig path aliases there): ${String((error as Error)?.message ?? error)}`, { cause: error });
  }
  if (!mod) throw new ConfigImportError("could not load app/config/config.ts (see the error above)");
  return apiTreeConfig(mod.default);
}

/** Flags first, then the config, then the defaults. `rootSource` names where the root came from, for error messages. */
export const resolveApiTree = (flags: ApiTreeConfig, config: ApiTreeConfig): Required<ApiTreeConfig> & { rootSource: string } => ({
  root: flags.root ?? config.root ?? DEFAULT_ROOT,
  base: flags.base ?? config.base ?? DEFAULT_BASE,
  rootSource: flags.root !== undefined ? "--root" : config.root !== undefined ? "config api.root" : "the default root",
});
