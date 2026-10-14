import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TraceMap, originalPositionFor, type SourceMapInput } from '@jridgewell/trace-mapping';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DI_PLUGIN_NAME, DI_VIRTUAL_ID, laratypeDi } from '../../src/di';
import { RollupPluginSwc } from '../../src/utils/plugin';
import { warmupSwcOptions } from './support/pipeline';

/**
 * T2 #102: `laratype:di` in the `sauf dev` chain (`warmup.ts`): DI transform -> SWC through Vite SSR,
 * with `virtual:laratype/di` resolved to `@laratype/core`.
 */
const appDir = fileURLToPath(new URL('./plugin-app', import.meta.url));
const mainFile = join(appDir, 'main.ts');

const callTransform = (plugin: Plugin, code: string, id: string) =>
  (plugin.transform as (code: string, id: string) => { code: string } | null).call({}, code, id);

describe('laratype:di plugin hooks', () => {
  const plugin = laratypeDi();
  (plugin.configResolved as (config: { root: string }) => void)({ root: appDir });
  const source = readFileSync(mainFile, 'utf8');

  it('runs before SWC', () => {
    expect(plugin.name).toBe(DI_PLUGIN_NAME);
    expect(plugin.enforce).toBe('pre');
  });

  it('transforms app .ts files, with or without a query', () => {
    expect(callTransform(plugin, source, mainFile)?.code).toContain('__laratype_deps(GreetingController, [() => GreetingService], { params: ["greeting"] });');
    expect(callTransform(plugin, source, `${mainFile}?v=1`)?.code).toContain(`from ${JSON.stringify(DI_VIRTUAL_ID)}`);
  });

  it.each([
    ['node_modules', join(appDir, 'node_modules/pkg/index.ts')],
    ['virtual ids', `\0${DI_VIRTUAL_ID}`],
    ['files outside the root', join(appDir, '../fixtures/constructors/main.ts')],
    ['declaration files', join(appDir, 'main.d.ts')],
    ['non-TypeScript files', join(appDir, 'main.js')],
  ])('skips %s', (_, id) => {
    expect(callTransform(plugin, source, id)).toBeNull();
  });
});

describe('laratype:di plugin through Vite SSR', () => {
  let server: ViteDevServer;

  beforeAll(async () => {
    server = await createServer({
      root: appDir,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      esbuild: false,
      optimizeDeps: { noDiscovery: true },
      server: { middlewareMode: true, hmr: false, watch: null },
      // Same order as `warmup.ts`.
      plugins: [laratypeDi(), RollupPluginSwc(warmupSwcOptions())],
    });
  });

  afterAll(async () => {
    await server?.close();
  });

  it('emits the deps call after SWC, with the helper imported from @laratype/core', async () => {
    const { code } = (await server.transformRequest(mainFile, { ssr: true }))!;
    expect(code).toMatch(/__laratype_deps\)\(GreetingController, \[\s*\(\)=>__vite_ssr_import_\d+__\.GreetingService\s*\]/);
    // Same module id as the file's own `@laratype/core` import (`sauf dev` loads it from src).
    expect(code).toMatch(/__vite_ssr_import__\("[^"]*\/packages\/core\/src\/index\.ts", \{"importedNames":\["__laratype_deps"\]\}/);
    expect(code).not.toContain(DI_VIRTUAL_ID);
  });

  it('chains the transform map with SWC', async () => {
    const result = await server.transformRequest(mainFile, { ssr: true });
    const generated = result!.code.split('\n');
    const line = generated.findIndex((l) => l.includes('this.greeting.greet('));
    const column = generated[line].indexOf('this.greeting.greet(');
    const original = originalPositionFor(new TraceMap(result!.map as SourceMapInput), { line: line + 1, column });
    // The DI transform adds the helper import on line 1, so an unchained map would point one line too far.
    const sourceLine = readFileSync(mainFile, 'utf8').split(/\r?\n/).findIndex((l) => l.includes('this.greeting.greet(')) + 1;
    expect(original.source?.replace(/\\/g, '/')).toMatch(/(^|\/)main\.ts$/);
    expect(original.line).toBe(sourceLine);
  });

  it('resolves virtual:laratype/di to @laratype/core, so the container autowires constructor deps', async () => {
    const mod = await server.ssrLoadModule(mainFile);
    expect(mod.show()).toBe('Hello plugin');
  });
});
