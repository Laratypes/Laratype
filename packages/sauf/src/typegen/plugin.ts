/**
 * `laratype:api`: resolves `$api` to the generated `<out>/api/index.gen.ts`. The first time the app imports `$api`,
 * the contract tree is scanned and its files are written (the dev startup scan of docs/v1/http.md › Router v2),
 * with the root and base from config `api.root` / `api.base`. Production reads the build manifest instead (#125).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { Console } from '@laratype/console';
import { apiTreeConfig, readApiTreeConfig, resolveApiTree } from './config';
import { syncContractTree } from './index';

export const API_PLUGIN_NAME = 'laratype:api';
export const API_ALIAS = '$api';

export interface ApiPluginOptions {
  /** Project directory. Default `process.cwd()`. */
  readonly projectDir?: string;
  /** Output folder, relative to the project. Default `.laratype`. */
  readonly outDir?: string;
  /** The config object. Default: the loaded app config, else `app/config/config.ts` imported on its own. */
  readonly config?: () => unknown;
}

const loadedConfig = () => (globalThis as { __laratype_config?: unknown }).__laratype_config;

export function laratypeApi(options: ApiPluginOptions = {}): Plugin {
  const projectDir = options.projectDir ?? process.cwd();
  const outDir = options.outDir ?? '.laratype';
  const indexFile = join(projectDir, outDir, 'api', 'index.gen.ts');
  let scanned: Promise<void> | undefined;

  // Route files import `$api` while the providers load, before ConfigLoadServiceProvider runs: read the file then
  const treeConfig = async () => {
    if (options.config) return apiTreeConfig(options.config());
    const loaded = loadedConfig();
    return loaded ? apiTreeConfig(loaded) : readApiTreeConfig(projectDir);
  };

  const scan = async () => {
    const tree = resolveApiTree({}, await treeConfig());
    const result = syncContractTree({ projectDir, outDir, ...tree });
    if (!result) Console.debug(`[${API_PLUGIN_NAME}] no contract tree at ${tree.root}: skipped the scan`);
  };

  return {
    name: API_PLUGIN_NAME,
    enforce: 'pre',
    async resolveId(source) {
      if (source !== API_ALIAS) return null;
      await (scanned ??= scan());
      return existsSync(indexFile) ? indexFile : null;
    },
  };
}
