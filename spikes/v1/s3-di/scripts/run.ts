/**
 * Runner: transform -> @swc/core (warmup.ts options) -> out/ -> Node ESM, one child process per case.
 * Usage: node scripts/run.ts   (Node >= 22.18, type stripping)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@swc/core';
import { transform, VIRTUAL_ID, type TransformOptions } from '../src/transform.ts';
import { warmupSwcOptions } from './swc-options.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'fixtures');
const out = join(root, 'out');

interface Case {
  name: string;
  dir: string;
  transform?: TransformOptions;
  decoratorMetadata?: boolean;
  /** Expected failure (stderr pattern); omitted = must exit 0. */
  expectError?: RegExp;
}

const LINK_ERROR = /SyntaxError: The requested module '\.\/types\.js' does not provide an export named 'Mailer'/;

const cases: Case[] = [
  ...['param-properties', 'inject-token', 'unresolved', 'generics', 'defaults', 'export-default', 'class-expression',
    'inheritance', 'circular', 'class-decorator', 'nested-shadowing', 'inject-conflict'].map((dir) => ({ name: dir, dir })),
  { name: 'interface-value-import', dir: 'interface-value-import', expectError: LINK_ERROR },
  {
    name: 'interface-value-import+namespace',
    dir: 'interface-value-import',
    transform: { importStrategy: 'namespace' },
    expectError: /DiError: Cannot resolve Notifier constructor param #0 `mailer`: its type resolved to undefined at runtime/,
  },
  { name: 'metadata-keeps-import', dir: 'metadata-keeps-import', expectError: LINK_ERROR },
  { name: 'metadata-keeps-import+no-metadata', dir: 'metadata-keeps-import', decoratorMetadata: false },
  // decoratorMetadata stays ON; `import type` alone is enough (verbatimModuleSyntax forces it).
  { name: 'metadata-import-type', dir: 'metadata-import-type' },
];

const compile = (code: string, filename: string, decoratorMetadata?: boolean) =>
  transformSync(code, { ...warmupSwcOptions({ decoratorMetadata }), filename }).code;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'runtime.js'), compile(readFileSync(join(root, 'src/runtime.ts'), 'utf8'), 'runtime.ts'));

let failed = 0;
for (const c of cases) {
  const src = join(fixtures, c.dir);
  const dest = join(out, c.name);
  mkdirSync(dest, { recursive: true });
  for (const file of readdirSync(src).filter((f) => f.endsWith('.ts'))) {
    const code = readFileSync(join(src, file), 'utf8');
    const t = transform(code, join(src, file), c.transform);
    const transformed = t?.code ?? code;
    writeFileSync(join(dest, file.replace(/\.ts$/, '.transformed.ts')), transformed);
    const js = compile(transformed, join(src, file), c.decoratorMetadata)
      .replaceAll(JSON.stringify(VIRTUAL_ID), '"../runtime.js"')
      .replaceAll(`'${VIRTUAL_ID}'`, '"../runtime.js"');
    writeFileSync(join(dest, file.replace(/\.ts$/, '.js')), js);
  }

  const r = spawnSync(process.execPath, [join(dest, 'main.js')], { encoding: 'utf8' });
  const stderr = r.stderr.trim();
  let ok: boolean;
  let detail = '';
  if (c.expectError) {
    ok = r.status !== 0 && c.expectError.test(stderr);
    detail = stderr.split('\n').find((l) => c.expectError!.test(l)) ?? stderr.split('\n').slice(0, 6).join('\n');
  } else {
    ok = r.status === 0;
    detail = stderr;
  }
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}${c.expectError ? '  (expected error)' : ''}`);
  if (detail && (!ok || c.expectError)) console.log(`      ${detail.replaceAll('\n', '\n      ')}`);
}

// Statement order after SWC for class decorators: __laratype_deps must come after `X = _ts_decorate(...)`.
const decorated = readFileSync(join(out, 'class-decorator/main.js'), 'utf8');
for (const name of ['Svc', 'Swapped']) {
  const decorate = decorated.indexOf(`${name} = _ts_decorate(`);
  const deps = decorated.indexOf(`__laratype_deps(${name},`);
  const ok = decorate !== -1 && deps > decorate;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  swc order: ${name} = _ts_decorate(...) before __laratype_deps(${name}, ...)`);
}

// Typecheck: verbatimModuleSyntax must flag exactly the interface-imported-as-value fixtures (TS1484).
// typescript is not in the spikes/v1 deps junction; point TSC_BIN at any tsc >= 5.0.
const tscBin = process.env.TSC_BIN ?? 'D:/Laratype/Laratype/node_modules/typescript/bin/tsc';
let tscOut = '';
try {
  tscOut = execFileSync(process.execPath, [tscBin, '--noEmit', '-p', join(root, 'tsconfig.json')], { encoding: 'utf8' });
} catch (e: any) {
  tscOut = String(e.stdout ?? '') + String(e.stderr ?? '');
}
const tsErrors = tscOut.split('\n').filter((l) => /error TS\d+/.test(l)).map((l) => l.trim());
const expected = tsErrors.filter((l) => l.includes('TS1484') && /(interface-value-import|metadata-keeps-import)/.test(l));
const unexpected = tsErrors.filter((l) => !expected.includes(l));
const tscOk = expected.length === 2 && unexpected.length === 0;
if (!tscOk) failed++;
console.log(`${tscOk ? 'PASS' : 'FAIL'}  tsc --noEmit (verbatimModuleSyntax): ${expected.length} expected TS1484, ${unexpected.length} unexpected`);
for (const l of [...expected, ...unexpected]) console.log(`      ${relative(root, l)}`);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
