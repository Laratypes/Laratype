import { existsSync } from "node:fs";
import { isAbsolute, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { importModule } from "@laratype/support";
import { ScanError, checkBase } from "./scan";

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

/** A relative path that stays inside the project: not absolute, no leading `..`. */
export const insideProject = (path: string) => {
  const p = posix.normalize(path.replace(/\\/g, "/"));
  return !isAbsolute(path) && !/^[a-zA-Z]:/.test(path) && p !== "." && p !== ".." && !p.startsWith("../");
};

/** Checks the `api` key of a config object; a missing key is `{}`. */
export function apiTreeConfig(config: unknown): ApiTreeConfig {
  const api = (config as { api?: unknown } | null | undefined)?.api;
  if (api === undefined) return {};
  if (typeof api !== "object" || api === null) throw new ScanError("config api must be { root?, base? }");
  const { root, base } = api as Record<string, unknown>;
  if (root !== undefined && (typeof root !== "string" || root === "")) throw new ScanError("config api.root must be a folder, relative to the project");
  if (root !== undefined && !insideProject(root as string)) {
    throw new ScanError(`config api.root "${root}" must be a folder inside the project, relative to it`);
  }
  if (base !== undefined) checkBase(base, "config api.base");
  return { root: root as string | undefined, base: base as string | undefined };
}

/**
 * Reads `api` from `app/config/config.ts` by importing that file only: no provider boots, so no database, auth
 * or env is needed. A project without the file uses the defaults.
 */
export async function readApiTreeConfig(projectDir: string, load: (url: string) => Promise<unknown> = (url) => importModule(url)): Promise<ApiTreeConfig> {
  const file = join(projectDir, "app", "config", "config.ts");
  if (!existsSync(file)) return {};
  const mod = (await load(pathToFileURL(file).href)) as { default?: unknown } | undefined;
  if (!mod) throw new ScanError("could not load app/config/config.ts (see the error above)");
  return apiTreeConfig(mod.default);
}

/** Flags first, then the config, then the defaults. */
export const resolveApiTree = (flags: ApiTreeConfig, config: ApiTreeConfig): Required<ApiTreeConfig> => ({
  root: flags.root ?? config.root ?? DEFAULT_ROOT,
  base: flags.base ?? config.base ?? DEFAULT_BASE,
});
