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

/** `@laratype/core` sources, compiled next to the stub for fixtures that import from `@laratype/core`. */
export const coreSourceDir = join(here, '../../../../core/src');
const CORE_ID = '@laratype/core';

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
    mkdirSync(join(outRoot, 'core'));
    for (const file of readdirSync(coreSourceDir).filter((f) => f.endsWith('.ts'))) {
      const { code } = transformSync(readFileSync(join(coreSourceDir, file), 'utf8'), { ...warmupSwcOptions(), filename: file });
      // Node ESM needs the extension on relative specifiers.
      writeFileSync(join(outRoot, 'core', file.replace(/\.ts$/, '.js')), code.replace(/(from ["']\.\/[\w-]+)(["'])/g, '$1.js$2'));
    }
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

/**
 * DI transform -> SWC (warmup options) -> Node ESM, in its own process, like `sauf dev`/`build` would run it.
 * `virtual:laratype/di` maps to the stub, or to the compiled `@laratype/core` when the fixture imports it.
 */
export function runFixture(dir: string, { decoratorMetadata = true } = {}): FixtureRun {
  const src = join(fixturesDir, dir);
  const dest = join(getOutRoot(), `${dir}${decoratorMetadata ? '' : '-no-metadata'}`);
  mkdirSync(dest, { recursive: true });
  const transformed = transformFixture(dir);
  const sources = Object.fromEntries(fixtureFiles(dir).map((file) => [file, transformed[file] ?? readFileSync(join(src, file), 'utf8')]));
  const usesCore = Object.values(sources).some((code) => code.includes(CORE_ID));
  const runtime = usesCore ? '"../core/index.js"' : '"../runtime.js"';
  const js: Record<string, string> = {};
  for (const [file, code] of Object.entries(sources)) {
    const out = transformSync(code, { ...swcOptionsFor(file, decoratorMetadata), filename: join(src, file) }).code
      .replaceAll(JSON.stringify(DI_VIRTUAL_ID), runtime)
      .replaceAll(`'${DI_VIRTUAL_ID}'`, runtime)
      .replaceAll(JSON.stringify(CORE_ID), '"../core/index.js"')
      .replaceAll(`'${CORE_ID}'`, '"../core/index.js"');
    js[file] = out;
    writeFileSync(join(dest, file.replace(/\.tsx?$/, '.js')), out);
  }
  const r = spawnSync(process.execPath, [join(dest, 'main.js')], { encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr.trim(), js };
}
