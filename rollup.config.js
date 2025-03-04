import esbuild from 'rollup-plugin-esbuild'
import { entries } from "./scripts/alias.js";
import alias from '@rollup/plugin-alias'
import path from "path";
import { existsSync } from "fs";
import { nodeResolve } from "@rollup/plugin-node-resolve"
import commonjs from '@rollup/plugin-commonjs';


/**
 * @param {string} targetFile
 * @return {import("rollup").Plugin}
 */
const removeHashBang = (targetFile) => {
  return {
    name: 'removeHashBang',
    transform(source, id) {
      let _source = source
      if(id.includes('sauf/src/bin/index.ts')) {
        _source = source.replace(/^#!.*\n/, '');
      }
      return _source;
    }
  }
}

const tasks = Object.entries(entries)
  .filter(([pkgName, entryPoint]) => existsSync(entryPoint))
  .map(([pkgName, entryPoint]) => {
    const dir = path.resolve(`./packages/${pkgName.replace('@laratype', '')}/dist`);
    
    return {
      input: entryPoint,
      output: [
        {
          file: `${dir}/index.js`,
          format: 'cjs',
        },
        {
          file: `${dir}/index.esm.js`,
          format: 'esm',
        },
      ],
      plugins: [
        alias({ entries }),
        commonjs({}),
        nodeResolve(),
        (pkgName === 'sauf' ? removeHashBang('sauf/src/bin/index.ts') : {}),
        esbuild({
          tsconfig: 'tsconfig.build.json',
          banner: pkgName === 'sauf' ? '#!/usr/bin/env node' : undefined,
          minify: pkgName !== 'sauf',
        }),
      ],
    }
  })

tasks.push({
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/index.js',
      format: 'cjs',
    },
    {
      file: 'dist/index.esm.js',
      format: 'esm',
    },
  ],
  plugins: [
    alias({ entries }),
    commonjs({}),
    nodeResolve(),
    esbuild({
      tsconfig: 'tsconfig.build.json',
      minify: true,
    }),
  ],
})

export default tasks;