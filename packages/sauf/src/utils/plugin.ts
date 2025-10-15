import type { Compiler, Options } from '@swc/core';
import { resolvePathSync, type Plugin } from '@laratype/support';
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
    async transform(code, id) {
      if (filter(id) || filter(cleanUrl(id))) {
        if (!swc) {
          const swcCore = resolvePathSync('@swc/core', { url: import.meta.url });
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
