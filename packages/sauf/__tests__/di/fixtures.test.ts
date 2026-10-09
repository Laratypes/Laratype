import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixturesDir, runFixture, transformFixture } from './support/pipeline';

/**
 * One directory per edge case (S3 #86 fixtures + T1 #101 additions). Each `main.ts` asserts at runtime.
 * - Snapshots: the DI transform output of every fixture file, in `__snapshots__/<case>/<file>`.
 * - Runtime: transform -> SWC (warmup.ts options) -> Node ESM, against the D2-shaped stub in `support/runtime.ts`.
 */
const cases = readdirSync(fixturesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

const LINK_ERROR = /SyntaxError: The requested module '\.\/types\.js' does not provide an export named 'Mailer'/;

/** An interface imported without `type` (TS1484 under verbatimModuleSyntax, see #87) fails to link under Node ESM. */
const expectedFailures: Record<string, RegExp> = {
  'interface-value-import': LINK_ERROR,
  'metadata-keeps-import': LINK_ERROR,
};

describe('DI transform output snapshots', () => {
  it.each(cases)('%s', async (dir) => {
    for (const [file, code] of Object.entries(transformFixture(dir))) {
      await expect(code ?? '// not transformed\n').toMatchFileSnapshot(`__snapshots__/${dir}/${file}`);
    }
  });
});

describe('DI transform runtime (Node ESM)', () => {
  it.each(cases.filter((dir) => !(dir in expectedFailures)))('%s', (dir) => {
    const r = runFixture(dir);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it.each(Object.entries(expectedFailures))('%s fails to link', (dir, error) => {
    const r = runFixture(dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(error);
  });

  it('metadata-keeps-import passes with decoratorMetadata off', () => {
    const r = runFixture('metadata-keeps-import', { decoratorMetadata: false });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('places __laratype_deps after SWC reassigns the decorated class', () => {
    const { js } = runFixture('class-decorator');
    for (const [file, name] of [['main.ts', 'Svc'], ['main.ts', 'Swapped'], ['anon.ts', '__laratype_default']]) {
      const decorate = js[file].indexOf(`${name} = _ts_decorate(`);
      expect(decorate, `${name} is decorated`).toBeGreaterThan(-1);
      expect(js[file].indexOf(`__laratype_deps(${name},`)).toBeGreaterThan(decorate);
    }
  });
});
