/**
 * Same fixtures through Vite's ssrLoadModule (what `sauf dev` uses: DevRunner -> vite.ssrLoadModule),
 * with the DI transform as an `enforce: 'pre'` plugin before an SWC plugin using the warmup.ts options.
 * Usage: VITE_PATH=<path to vite/dist/node/index.js> node scripts/vite-check.ts
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformSync } from '@swc/core';
import { transform, VIRTUAL_ID, type TransformOptions } from '../src/transform.ts';
import { warmupSwcOptions } from './swc-options.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vitePath = process.env.VITE_PATH
  ?? 'D:/Laratype/Laratype/node_modules/.bun/vite@7.1.10+1f32cd1528093a52/node_modules/vite/dist/node/index.js';
const { createServer } = await import(pathToFileURL(vitePath).href);

const runtimePath = join(root, 'src/runtime.ts').replaceAll('\\', '/');

const plugins = (options: TransformOptions = {}) => [
  {
    name: 'laratype:di',
    enforce: 'pre',
    resolveId(id: string) {
      return id === VIRTUAL_ID ? runtimePath : null;
    },
    transform(code: string, id: string) {
      if (!/\.ts$/.test(id) || id === runtimePath) return null;
      const r = transform(code, id, options);
      return r && { code: r.code, map: r.map };
    },
  },
  {
    name: 'swc',
    transform(code: string, id: string) {
      if (!/\.ts$/.test(id)) return null;
      const r = transformSync(code, { ...warmupSwcOptions(), filename: id });
      return { code: r.code, map: r.map };
    },
  },
];

const run = async (dir: string, options?: TransformOptions) => {
  const server = await createServer({
    root: join(root, 'fixtures', dir),
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    esbuild: false,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false },
    plugins: plugins(options),
  });
  try {
    await server.ssrLoadModule(join(root, 'fixtures', dir, 'main.ts'));
    return 'ok';
  } catch (e: any) {
    return `${e?.name}: ${String(e?.message).split('\n')[0]}`;
  } finally {
    await server.close();
  }
};

for (const dir of ['param-properties', 'inject-token', 'unresolved', 'generics', 'defaults', 'export-default',
  'class-expression', 'inheritance', 'circular', 'class-decorator', 'nested-shadowing', 'inject-conflict']) {
  console.log(`${dir}: ${await run(dir)}`);
}
console.log(`interface-value-import (direct): ${await run('interface-value-import')}`);
console.log(`interface-value-import (namespace): ${await run('interface-value-import', { importStrategy: 'namespace' })}`);
console.log(`metadata-keeps-import (decoratorMetadata on): ${await run('metadata-keeps-import')}`);

// Production bundle (vite build = Rollup): what happens to the link error, and to namespace imports.
const { build } = await import(pathToFileURL(vitePath).href);
const bundle = async (dir: string, options?: TransformOptions) => {
  try {
    const out: any = await build({
      root: join(root, 'fixtures', dir),
      configFile: false,
      logLevel: 'silent',
      esbuild: false,
      plugins: plugins(options),
      build: { ssr: join(root, 'fixtures', dir, 'main.ts'), write: false, minify: false },
    });
    const code: string = (Array.isArray(out) ? out[0] : out).output[0].code;
    return { ok: true, code };
  } catch (e: any) {
    return { ok: false, code: `${String(e?.message).split('\n')[0]}` };
  }
};
const direct = await bundle('param-properties');
const ns = await bundle('param-properties', { importStrategy: 'namespace' });
console.log(`build param-properties direct: ${direct.ok ? `${direct.code.length} bytes` : direct.code}`);
console.log(`build param-properties namespace: ${ns.ok ? `${ns.code.length} bytes, namespace object materialised: ${/__di_ns0|Object\.freeze|Symbol\.toStringTag/.test(ns.code)}` : ns.code}`);
const missing = await bundle('interface-value-import');
console.log(`build interface-value-import direct: ${missing.ok ? 'built (no error)' : missing.code}`);
const missingNs = await bundle('interface-value-import', { importStrategy: 'namespace' });
console.log(`build interface-value-import namespace: ${missingNs.ok ? `built; deps call: ${missingNs.code.match(/__laratype_deps\(Notifier[^;]*/)?.[0].replace(/\s+/g, " ")}` : missingNs.code}`);
