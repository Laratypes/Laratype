/**
 * `laratype:di`: runs the DI transform on app `.ts` files before SWC, and resolves the helper
 * import `virtual:laratype/di` to `@laratype/core`.
 */
import type { Plugin } from 'vite';
import { DI_VIRTUAL_ID, transformDi, type DiTransformOptions } from './transform';

export const DI_PLUGIN_NAME = 'laratype:di';
/** The package `virtual:laratype/di` resolves to. */
export const DI_RUNTIME_ID = '@laratype/core';

const queryRE = /[?#].*$/;
const tsRE = /\.(c|m)?tsx?$/;
const dtsRE = /\.d\.(c|m)?ts$/;

const normalize = (path: string) => path.replace(/\\/g, '/');

export function laratypeDi(options: DiTransformOptions = {}): Plugin {
  let root = normalize(process.cwd());

  /**
   * App files only: under the Vite root and outside `node_modules`. Framework sources are skipped too
   * (in the monorepo `sauf dev` loads them from each package's `src`), so `@laratype/core` never imports itself.
   */
  const isAppFile = (id: string) => {
    if (id.startsWith('\0') || id.startsWith('virtual:')) return false;
    const file = normalize(id.replace(queryRE, ''));
    return tsRE.test(file)
      && !dtsRE.test(file)
      && !file.includes('/node_modules/')
      && file.startsWith(`${root}/`);
  };

  return {
    name: DI_PLUGIN_NAME,
    enforce: 'pre',
    configResolved(config) {
      root = normalize(config.root);
    },
    async resolveId(source, importer, resolveOptions) {
      if (source !== DI_VIRTUAL_ID) return null;
      // Resolve from the importing file, then through `laratype`, which depends on `@laratype/core`
      // when the app does not list it.
      const resolved = await this.resolve(DI_RUNTIME_ID, importer, { ...resolveOptions, skipSelf: true });
      if (resolved) return resolved;
      const kernel = await this.resolve('laratype', importer, { ...resolveOptions, skipSelf: true });
      return kernel ? this.resolve(DI_RUNTIME_ID, kernel.id, { ...resolveOptions, skipSelf: true }) : null;
    },
    transform(code, id) {
      if (!isAppFile(id)) return null;
      const result = transformDi(code, id, options);
      // Vite composes this map with the SWC plugin's.
      return result && { code: result.code, map: result.map };
    },
  };
}
