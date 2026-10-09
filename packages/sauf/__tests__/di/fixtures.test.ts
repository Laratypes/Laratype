import { describe, expect, it } from 'vitest';
import { runFixture } from './support/pipeline';

// S3 fixtures (#86, PR #183) executed end to end: transform -> SWC -> Node ESM. Each `main.ts` asserts at runtime.
const passing = [
  'param-properties',
  'inject-token',
  'unresolved',
  'generics',
  'defaults',
  'export-default',
  'class-expression',
  'inheritance',
  'circular',
  'class-decorator',
  'nested-shadowing',
  'inject-conflict',
  'metadata-import-type',
  // Added for the items carried from S3.
  'named-evaluation',
  'nullable',
  'var-hoisting',
  'non-ascii',
];

const LINK_ERROR = /SyntaxError: The requested module '\.\/types\.js' does not provide an export named 'Mailer'/;

describe('DI transform fixtures (Node ESM)', () => {
  it.each(passing)('%s', (dir) => {
    const r = runFixture(dir);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('metadata-keeps-import passes with decoratorMetadata off', () => {
    const r = runFixture('metadata-keeps-import', { decoratorMetadata: false });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  // Expected failures: an interface imported without `type` (TS1484 under verbatimModuleSyntax, see #87).
  it.each(['interface-value-import', 'metadata-keeps-import'])('%s fails with an ESM link error', (dir) => {
    const r = runFixture(dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(LINK_ERROR);
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
