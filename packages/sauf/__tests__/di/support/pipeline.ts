import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync, type Options } from '@swc/core';
import { DI_VIRTUAL_ID, transformDi } from '../../../src/di';

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

let outRoot: string | undefined;
const getOutRoot = () => {
  if (!outRoot) {
    outRoot = mkdtempSync(join(tmpdir(), 'laratype-di-'));
    const runtime = readFileSync(join(here, 'runtime.ts'), 'utf8');
    writeFileSync(join(outRoot, 'runtime.js'), transformSync(runtime, { ...warmupSwcOptions(), filename: 'runtime.ts' }).code);
  }
  return outRoot;
};

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
  const js: Record<string, string> = {};
  for (const file of readdirSync(src).filter((f) => f.endsWith('.ts'))) {
    const code = readFileSync(join(src, file), 'utf8');
    const transformed = transformDi(code, join(src, file))?.code ?? code;
    const out = transformSync(transformed, { ...warmupSwcOptions(decoratorMetadata), filename: join(src, file) }).code
      .replaceAll(JSON.stringify(DI_VIRTUAL_ID), '"../runtime.js"')
      .replaceAll(`'${DI_VIRTUAL_ID}'`, '"../runtime.js"');
    js[file] = out;
    writeFileSync(join(dest, file.replace(/\.ts$/, '.js')), out);
  }
  const r = spawnSync(process.execPath, [join(dest, 'main.js')], { encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr.trim(), js };
}
