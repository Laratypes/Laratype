import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync, type Options } from '@swc/core';
import { DI_VIRTUAL_ID, transformDi, type DiTransformOptions } from '../../../src/di';

const here = fileURLToPath(new URL('.', import.meta.url));
export const fixturesDir = join(here, '../fixtures');

/** Same options as the `RollupPluginSwc` call in `packages/sauf/src/bin/warmup.ts`. */
export const warmupSwcOptions = (decoratorMetadata = true): Options => ({
  sourceMaps: true,
  module: {
    type: 'es6',
  },
  jsc: {
    target: 'es2022',
    parser: {
      syntax: 'typescript',
      decorators: true,
      tsx: false,
    },
    transform: {
      legacyDecorator: true,
      decoratorMetadata,
    },
  },
});

/** The `virtual:laratype/di` implementation fixtures run against (D2-shaped stub until `@laratype/core` lands). */
export const runtimeSource = join(here, 'runtime.ts');

/** SWC options for one file; `.tsx` gets JSX with a classic `h` pragma so fixtures can define their own. */
const swcOptionsFor = (file: string, decoratorMetadata: boolean): Options => {
  const options = warmupSwcOptions(decoratorMetadata);
  if (!file.endsWith('.tsx')) return options;
  return {
    ...options,
    jsc: {
      ...options.jsc,
      parser: { syntax: 'typescript', decorators: true, tsx: true },
      transform: { ...options.jsc!.transform, react: { runtime: 'classic', pragma: 'h' } },
    },
  };
};

let outRoot: string | undefined;
const getOutRoot = () => {
  if (!outRoot) {
    outRoot = mkdtempSync(join(tmpdir(), 'laratype-di-'));
    const runtime = readFileSync(runtimeSource, 'utf8');
    writeFileSync(join(outRoot, 'runtime.js'), transformSync(runtime, { ...warmupSwcOptions(), filename: 'runtime.ts' }).code);
  }
  return outRoot;
};

/** Source files of a fixture, in a stable order. */
export const fixtureFiles = (dir: string) =>
  readdirSync(join(fixturesDir, dir)).filter((f) => /\.tsx?$/.test(f)).sort();

/** Transform options for a fixture, from an optional `di.options.json` next to its sources. */
const fixtureOptions = (dir: string): DiTransformOptions => {
  const file = join(fixturesDir, dir, 'di.options.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};

/** DI transform output per fixture file (`null` when the transform leaves the file untouched). */
export function transformFixture(dir: string): Record<string, string | null> {
  const options = fixtureOptions(dir);
  return Object.fromEntries(fixtureFiles(dir).map((file) => {
    const path = join(fixturesDir, dir, file);
    return [file, transformDi(readFileSync(path, 'utf8'), path, options)?.code ?? null];
  }));
}

export interface FixtureRun {
  status: number | null;
  stderr: string;
  /** Compiled JS per fixture file (`main.ts` -> SWC output). */
  js: Record<string, string>;
}

/** DI transform -> SWC (warmup options) -> Node ESM, in its own process, like `sauf dev`/`build` would run it. */
export function runFixture(dir: string, { decoratorMetadata = true } = {}): FixtureRun {
  const src = join(fixturesDir, dir);
  const dest = join(getOutRoot(), `${dir}${decoratorMetadata ? '' : '-no-metadata'}`);
  mkdirSync(dest, { recursive: true });
  const transformed = transformFixture(dir);
  const js: Record<string, string> = {};
  for (const file of fixtureFiles(dir)) {
    const code = transformed[file] ?? readFileSync(join(src, file), 'utf8');
    const out = transformSync(code, { ...swcOptionsFor(file, decoratorMetadata), filename: join(src, file) }).code
      .replaceAll(JSON.stringify(DI_VIRTUAL_ID), '"../runtime.js"')
      .replaceAll(`'${DI_VIRTUAL_ID}'`, '"../runtime.js"');
    js[file] = out;
    writeFileSync(join(dest, file.replace(/\.tsx?$/, '.js')), out);
  }
  const r = spawnSync(process.execPath, [join(dest, 'main.js')], { encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr.trim(), js };
}
