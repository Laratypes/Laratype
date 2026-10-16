/**
 * `laratype:api`: resolves `$api` to the generated `<out>/api/index.gen.ts`. The contract tree is scanned and its
 * files are written on each server start and restart (`sauf dev` calls `rescan()`), and on the first `$api` import
 * when nothing called it, with the root and base from config `api.root` / `api.base` (docs/v1/http.md › Router v2).
 * Production reads the build manifest instead (#125).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { Console } from '@laratype/console';
import { apiTreeConfig, readApiTreeConfig, resolveApiTree } from './config';
import { syncContractTree } from './index';
import { ScanError } from './scan';

export const API_PLUGIN_NAME = 'laratype:api';
export const API_ALIAS = '$api';

export interface ApiPluginOptions {
  /** Project directory. Default `process.cwd()`. */
  readonly projectDir?: string;
  /** Output folder, relative to the project. Default `.laratype`. */
  readonly outDir?: string;
  /** The config object. Default: `app/config/config.ts`, imported on its own, so a change to it applies on the next restart. */
  readonly config?: () => unknown;
}

/** `plugin.api` of `laratype:api`. */
export interface ApiPluginApi {
  /** Scans the tree again and writes the files that changed. A rejected scan is not cached: the next call retries. */
  rescan(): Promise<void>;
}

export function laratypeApi(options: ApiPluginOptions = {}): Plugin<ApiPluginApi> {
  const projectDir = options.projectDir ?? process.cwd();
  const outDir = options.outDir ?? '.laratype';
  const indexFile = join(projectDir, outDir, 'api', 'index.gen.ts');
  let current: Promise<void> | undefined;
  let server: ViteDevServer | undefined;

  const scan = async () => {
    const tree = resolveApiTree({}, options.config ? apiTreeConfig(options.config()) : await readApiTreeConfig(projectDir));
    const result = syncContractTree({ projectDir, outDir, ...tree });
    if (!result) {
      Console.debug(`[${API_PLUGIN_NAME}] no contract tree at ${tree.root}: skipped the scan`);
      return;
    }
    // A rewritten index must not be served from the module cache; `.laratype` writes do not restart the dev server
    if (server && result.changed.length) {
      for (const mod of server.moduleGraph.getModulesByFile(indexFile) ?? []) server.moduleGraph.invalidateModule(mod, new Set(), Date.now(), true);
    }
  };

  const rescan = () => {
    const run = scan().catch((error: unknown) => {
      if (current === run) current = undefined;
      throw error instanceof ScanError ? new ScanError(`[${API_PLUGIN_NAME}] ${error.message}`) : error;
    });
    current = run;
    return run;
  };

  return {
    name: API_PLUGIN_NAME,
    enforce: 'pre',
    api: { rescan },
    configureServer(devServer) {
      server = devServer;
    },
    async resolveId(source) {
      if (source !== API_ALIAS) return null;
      await (current ?? rescan());
      return existsSync(indexFile) ? indexFile : null;
    },
  };
}

/** Rescans through the `laratype:api` plugin of a Vite server, if it has one. */
export const rescanContractTree = async (plugins: readonly { name: string; api?: unknown }[]) => {
  const plugin = plugins.find((p) => p.name === API_PLUGIN_NAME);
  await (plugin?.api as ApiPluginApi | undefined)?.rescan();
};
