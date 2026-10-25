/**
 * `laratype:di` for `Bun.build` (`bun.build.js`): runs the DI transform on framework `.ts` sources before Bun
 * transpiles them, and imports the helper from `@laratype/core` directly (an external in package builds).
 */
import { readFile } from 'node:fs/promises';
import { isTransformable, normalize, sourceRE } from './files';
import { DI_PLUGIN_NAME, DI_RUNTIME_ID } from './plugin';
import { transformDi, type DiTransformOptions } from './transform';

/** The subset of Bun's `BunPlugin` this plugin uses, so sauf builds without `bun-types`. */
export interface DiBunPlugin {
  name: string;
  setup(build: DiBunPluginBuilder): void;
}

export interface DiBunPluginBuilder {
  onLoad(
    options: { filter: RegExp },
    callback: (args: { path: string }) => Promise<{ contents: string; loader: 'ts' | 'tsx' } | undefined>,
  ): unknown;
}

export interface DiBunPluginOptions extends DiTransformOptions {
  /**
   * Further filter on the files the extension and `node_modules` checks let through. `bun.build.js` uses it to
   * keep the transform on the package's own `src/`. Defaults to every such file.
   */
  include?: (path: string) => boolean;
}

export function laratypeDiBun(options: DiBunPluginOptions = {}): DiBunPlugin {
  const { include, ...rest } = options;
  // `transformDi` defaults an undefined `helperId` to `virtual:laratype/di`, which a package build cannot resolve.
  const transformOptions = { ...rest, helperId: rest.helperId ?? DI_RUNTIME_ID };

  return {
    name: DI_PLUGIN_NAME,
    setup(build) {
      build.onLoad({ filter: sourceRE }, async ({ path }) => {
        const file = normalize(path);
        if (!isTransformable(file) || (include && !include(file))) return undefined;
        const code = await readFile(path, 'utf8');
        const result = transformDi(code, path, transformOptions);
        return { contents: result ? result.code : code, loader: file.endsWith('.tsx') ? 'tsx' : 'ts' };
      });
    },
  };
}
