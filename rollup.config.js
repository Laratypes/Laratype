import esbuild from 'rollup-plugin-esbuild'
import { entries } from "./scripts/alias.js";
import alias from '@rollup/plugin-alias'
import path from "path";
import { existsSync, readFileSync } from "fs";
import { nodeResolve } from "@rollup/plugin-node-resolve"
import commonjs from '@rollup/plugin-commonjs';
import esmShim from '@rollup/plugin-esm-shim';
import { mergeConfig } from 'vite';

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
    const buildFormat = JSON.parse(
      readFileSync(
        path.resolve(`./packages/${pkgName.replace('@laratype', '')}/package.json`), 'utf-8'
      )
    ).buildOptions ?? {};

    if(!buildFormat.external) {
      buildFormat.external = [];
    }

    buildFormat.external.push(/@laratype\/.*/);

    const baseConfig = {
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
        esmShim(),
        commonjs({
          ignoreDynamicRequires: true
        }),
        nodeResolve(),
        (pkgName === 'sauf' ? removeHashBang('sauf/src/bin/index.ts') : {}),
        esbuild({
          tsconfig: 'tsconfig.build.json',
          banner: pkgName === 'sauf' ? '#!/usr/bin/env node' : undefined,
          minify: pkgName !== 'sauf',
          minify: false,
          target: 'esnext',
          define: {
            __PROD__: `true`,
          }
        }),
      ],
    }

    const config = mergeConfig(baseConfig, buildFormat);

    return config;
  })

tasks.push({
  external: [
    /@laratype\/.*/,
  ],
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
      minify: false,
      define: {
        __PROD__: `true`,
      }
    }),
  ],
})

export default tasks;