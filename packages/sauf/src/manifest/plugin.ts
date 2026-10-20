/**
 * `laratype:manifest`: serves `virtual:laratype/app`, the app manifest (docs/v1/build.md › Plugin chain). Its loaders
 * import the app's source files, so Vite SSR transforms them like any other module. The folders are read on each load;
 * a file added to or deleted from one of them invalidates the module, so the next `sauf dev --hmr` restart sees it.
 * Production uses `dist/app.manifest.js` instead (`sauf build`). No runtime import of vite: this module is loaded on
 * every `sauf` start.
 */
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { slash } from '../typegen/sync';
import { emitManifest, emitManifestError, isManifestFile, ManifestScanError, scanManifest } from './scan';
import { MANIFEST_ID } from './load';

export const MANIFEST_PLUGIN_NAME = 'laratype:manifest';
const RESOLVED_ID = `\0${MANIFEST_ID}`;

export interface ManifestPluginOptions {
  /** Project directory. Default `process.cwd()`. */
  readonly projectDir?: string;
}

export function laratypeManifest(options: ManifestPluginOptions = {}): Plugin {
  const projectDir = resolve(options.projectDir ?? process.cwd());

  return {
    name: MANIFEST_PLUGIN_NAME,
    enforce: 'pre',
    resolveId(source) {
      return source === MANIFEST_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      try {
        return emitManifest(scanManifest(projectDir), (path) => slash(resolve(projectDir, path)));
      } catch (error) {
        // Thrown by appManifest() where the app is needed: `--help`, `types:generate` and `make:*` still run
        if (error instanceof ManifestScanError) return emitManifestError(`[${MANIFEST_PLUGIN_NAME}] ${error.message}`);
        throw error;
      }
    },
    configureServer(server) {
      const invalidate = (file: string) => {
        if (!isManifestFile(projectDir, file)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod, new Set(), Date.now(), true);
      };
      server.watcher.on('add', invalidate);
      server.watcher.on('unlink', invalidate);
    },
  };
}
