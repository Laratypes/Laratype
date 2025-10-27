import type { Plugin } from 'vite';
import type { Compiler, Options } from '@swc/core';
import { resolveSync } from '@laratype/support';
import { createFilter } from '@rollup/pluginutils';

const hashRE = /#.*$/;
const queryRE = /\?.*$/;
const cleanUrl = (url: string) =>
  url.replace(hashRE, '').replace(queryRE, '');

export function RollupPluginSwc(options: Options): Plugin {
  let swc: Compiler;
  // todo: load swc/tsconfig from config files
  const config: Options = {
    // options from swc config
    ...options,
  };

  const filter = createFilter(/\.(tsx?|jsx)$/, /\.js$/);

  return {
    name: 'rollup-plugin-swc',
    enforce: 'pre',
    resolveId: {
      order: 'pre',
      async handler(source, importer, options) {
        if(globalThis.__PROD__) {
          return null;
        }
        const resolution = await this.resolve(source, importer, options);
        if((source.startsWith('@laratype') || source.includes('laratype/dist/index.esm.js')) && resolution) {
          resolution.id = resolution.id.replace('dist/index.esm.js', 'src/index.ts');
        }
        return resolution;
      },
    },
    async transform(code, id) {
      if (filter(id) || filter(cleanUrl(id))) {
        if (!swc) {
          const swcCore = resolveSync('@swc/core', { url: import.meta.url });
          swc = await import(swcCore).then(({ Compiler }) => new Compiler());
        }

        const result = await swc.transform(code, {
          ...config,
          filename: id,
        });
        return {
          code: result.code,
          map: result.map,
        };
      }
    },
  };
}
