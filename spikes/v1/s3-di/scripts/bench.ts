/**
 * Transform cost over every .ts file in examples/basic/app, compared with SWC (warmup.ts options).
 * Cold = first pass in a fresh process (includes native binding load + JIT); warm = median of N passes.
 * Usage: node scripts/bench.ts [passes=30]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(root, '../../../examples/basic/app');
const passes = Number(process.argv[2] ?? 30);
/** --always-parse: disable the pre-check (every file is parsed, upper bound for constructor-heavy apps). */
const alwaysParse = process.argv.includes('--always-parse');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
const files = walk(appDir).map((path) => ({ path, code: readFileSync(path, 'utf8') }));
const bytes = files.reduce((n, f) => n + f.code.length, 0);

let t = performance.now();
const { transform } = await import('../src/transform.ts');
const loadTransform = performance.now() - t;
t = performance.now();
const { transformSync } = await import('@swc/core');
const { warmupSwcOptions } = await import('./swc-options.ts');
const loadSwc = performance.now() - t;
const swcOptions = warmupSwcOptions();

const diPass = () => {
  let changed = 0;
  let classes = 0;
  for (const f of files) {
    const r = transform(f.code, f.path, { alwaysParse });
    if (r) {
      changed++;
      classes += r.classes;
    }
  }
  return { changed, classes };
};
const swcPass = (input: (f: { path: string; code: string }) => string) => {
  for (const f of files) transformSync(input(f), { ...swcOptions, filename: f.path });
};
const pipelineInput = (f: { path: string; code: string }) => transform(f.code, f.path, { alwaysParse })?.code ?? f.code;

const time = (fn: () => unknown) => {
  const s = performance.now();
  fn();
  return performance.now() - s;
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// Cold (first pass in this process).
const coldDi = time(diPass);
const coldSwc = time(() => swcPass((f) => f.code));

const warmDi: number[] = [];
const warmSwc: number[] = [];
const warmPipeline: number[] = [];
for (let i = 0; i < passes; i++) {
  warmDi.push(time(diPass));
  warmSwc.push(time(() => swcPass((f) => f.code)));
  warmPipeline.push(time(() => swcPass(pipelineInput)));
}

// Per-file breakdown (warm) for the slowest files.
const perFile = files.map((f) => {
  const xs: number[] = [];
  for (let i = 0; i < 20; i++) xs.push(time(() => transform(f.code, f.path, { alwaysParse })));
  return { file: relative(appDir, f.path), size: f.code.length, ms: median(xs) };
}).sort((a, b) => b.ms - a.ms);

const stats = diPass();
const fmt = (n: number) => n.toFixed(3);
const n = files.length;
console.log(`mode: ${alwaysParse ? 'always parse' : 'constructor pre-check'}`);
console.log(`files: ${n} (${(bytes / 1024).toFixed(1)} KiB), files with emitted deps: ${stats.changed}, classes: ${stats.classes}`);
console.log(`module load: transform+oxc ${fmt(loadTransform)} ms, @swc/core ${fmt(loadSwc)} ms`);
console.log(`cold  DI transform: ${fmt(coldDi)} ms total, ${fmt(coldDi / n)} ms/file`);
console.log(`cold  SWC:          ${fmt(coldSwc)} ms total, ${fmt(coldSwc / n)} ms/file`);
console.log(`warm  DI transform: ${fmt(median(warmDi))} ms total, ${fmt(median(warmDi) / n)} ms/file (median of ${passes})`);
console.log(`warm  SWC:          ${fmt(median(warmSwc))} ms total, ${fmt(median(warmSwc) / n)} ms/file`);
console.log(`warm  DI + SWC:     ${fmt(median(warmPipeline))} ms total, ${fmt(median(warmPipeline) / n)} ms/file`);
console.log(`DI / SWC ratio (warm): ${(median(warmDi) / median(warmSwc) * 100).toFixed(1)}%`);
console.log('slowest files (warm median):');
for (const f of perFile.slice(0, 5)) console.log(`  ${fmt(f.ms)} ms  ${f.size} B  ${f.file}`);
