import { ENV_CONFIG_NAME } from "@laratype/core";
import type { EnvDefinition } from "@laratype/core";
import { loadDefault, manifestEntry, peekAppManifest } from "../manifest/AppManifest";
import { ServiceProvider } from "../ServiceProvider";
import { validateEnv } from "./validateEnv";
import { getProjectPath } from "../path-resolver/pathResolver";
import dotenv from "dotenv";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

/** The `.env.*` files of `dir`, sorted by name (a directory name with glob metacharacters is just a name). */
function envFilesIn(dir: string): string[] {
  let entries: string[];

  try {
    entries = readdirSync(dir);
  } catch {
    // A missing project directory, or one that is not a directory: no env file there
    return [];
  }

  return entries
    .filter((name) => {
      if (!name.startsWith('.env.')) return false;

      try {
        return statSync(resolve(dir, name)).isFile();
      } catch {
        // A broken symlink: not a file to read
        return false;
      }
    })
    .sort()
    .map((name) => resolve(dir, name));
}

/**
 * Loads the project's env file into `process.env`: `.env`, else `.env.local`, else the first `.env.*` in name order.
 * Values already set are kept. Shared by `EnvLoadServiceProvider`, `PassportServiceProvider.register()` (which imports app/config/auth.ts,
 * a config that reads `Env.get()`, before the providers boot) and the `sauf` contract-tree scan, which reads the config
 * before the providers boot. Returns the file it loaded. With `projectDir` and no env file there, nothing is loaded:
 * dotenv's own fallback would read `.env` from the current directory, another project's.
 */
export function loadEnv(projectDir?: string): string | undefined {
  const at = (file: string) => (projectDir ? resolve(projectDir, file) : getProjectPath(file, false));
  const priorities = [
    '.env',
    '.env.local',
  ].map((file) => at(file)).filter((file) => existsSync(file));

  const envFiles = envFilesIn(projectDir ? projectDir : process.cwd());

  envFiles.forEach((file) => {
    if(!priorities.includes(file)) {
      priorities.push(file);
    };
  });

  const path = priorities[0];
  if (projectDir !== undefined && path === undefined) return undefined;

  dotenv.config({
    path,
  });

  globalThis.__laratype_env_file = path;

  return path;
}

export default class EnvLoadServiceProvider extends ServiceProvider {

  /** Loads the env file, then validates `process.env` with `app/config/env.ts` (`defineEnv`) when the app has one. */
  public async boot() {
    loadEnv();
    // `.env` needs no manifest: a script or a test can boot this provider without `sauf`. Only the env file entry, and
    // so the validation, comes from the manifest; a manifest with a scan error still fails the boot (manifestEntry).
    if (peekAppManifest() === undefined) return;
    const entry = manifestEntry('configs', ENV_CONFIG_NAME);
    if (entry) await validateEnv(await loadDefault<EnvDefinition>(entry), process.env);
  }

}
