import { ENV_CONFIG_NAME } from "@laratype/core";
import type { EnvDefinition } from "@laratype/core";
import { loadDefault, manifestEntry } from "../manifest/AppManifest";
import { ServiceProvider } from "../ServiceProvider";
import { validateEnv } from "./validateEnv";
import { getProjectPath } from "../path-resolver/pathResolver";
import { globSync } from "glob";
import dotenv from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

/**
 * Loads the project's env file into `process.env`: `.env`, else `.env.local`, else the first `.env.*`. Values already
 * set are kept. Shared by `EnvLoadServiceProvider` and the `sauf` contract-tree scan, which reads the config before the
 * providers boot. Returns the file it loaded. With `projectDir` and no env file there, nothing is loaded: dotenv's own
 * fallback would read `.env` from the current directory, another project's.
 */
export function loadEnv(projectDir?: string): string | undefined {
  const at = (file: string) => (projectDir ? resolve(projectDir, file) : getProjectPath(file, false));
  const priorities = [
    '.env',
    '.env.local',
  ].map((file) => at(file)).filter((file) => existsSync(file));

  const envFiles = globSync(at('.env.*'), {
    windowsPathsNoEscape: true,
  });

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
    const entry = manifestEntry('configs', ENV_CONFIG_NAME);
    if (entry) await validateEnv(await loadDefault<EnvDefinition>(entry), process.env);
  }

}
