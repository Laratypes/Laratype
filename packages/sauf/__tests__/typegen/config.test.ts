import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import TypesGenerateCommand, { runTypesGenerate } from '../../src/commands/types/generate';
import { pathToFileURL } from 'node:url';
import { normalizePath } from 'vite';
import { bootsApp } from '../../src/utils/command';
import { ScanError, apiTreeConfig, contractTreePlugin, isolatedImport, laratypeApi, readApiTreeConfig, resolveApiTree, syncContractTree } from '../../src/typegen';
import type { ApiPluginApi } from '../../src/typegen';
import { scanFiles } from '../../src/typegen';
import { shouldRestart } from '../../src/utils/restarter';

/**
 * The contract-root config key (H1 #104): `api.root` / `api.base` in app/config/config.ts, read by
 * `sauf types:generate` and by the `$api` dev scan; `--root` / `--base` override it.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\\/g, '/');

const tsconfig = {
  compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, verbatimModuleSyntax: true,
    skipLibCheck: true, noEmit: true, types: [], lib: ['ES2022', 'DOM'], rootDirs: ['.', '.laratype/types'],
    paths: { $api: ['./.laratype/api/index.gen.ts'], '@laratype/contract': [`${repo}packages/contract/src/index.ts`], zod: [`${repo}node_modules/zod`] },
  },
  include: ['app', '.laratype'],
};

// sauf loads the config through its Vite runner (`__sauf_transpiler_instance`); here vitest's loader stands in for it
const load = (url: string) => import(/* @vite-ignore */ url);

let tmp: string;
const project = (name: string, config?: string, treeRoot = 'app/api') => {
  const dir = join(tmp, name);
  mkdirSync(join(dir, treeRoot), { recursive: true });
  cpSync(join(here, 'fixtures/project/app/api'), join(dir, treeRoot), { recursive: true });
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ ...tsconfig, include: ['app', '.laratype'] }));
  if (config !== undefined) {
    mkdirSync(join(dir, 'app/config'), { recursive: true });
    writeFileSync(join(dir, 'app/config/config.ts'), config);
  }
  return dir;
};

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'laratype-apiconfig-'));
  // No database or auth configuration: the command must not need them
  for (const key of Object.keys(process.env)) if (/^(DB|AUTH)_/.test(key)) delete process.env[key];
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('api config key', () => {
  it('rejects a root outside the project, absolute paths included, naming where it came from (one rule)', async () => {
    // the message shows the normalized root
    expect(() => syncContractTree({ projectDir: tmp, ...resolveApiTree({}, { root: 'app/../../api' }) })).toThrow('the contract tree root "../api" (config api.root)');
    for (const root of ['/srv/api', '../api', '.', '..']) {
      const tree = resolveApiTree({}, apiTreeConfig({ api: { root } }));
      expect(() => syncContractTree({ projectDir: tmp, ...tree })).toThrow(`the contract tree root "${root}" (config api.root) must be a folder inside the project`);
    }
    expect(() => syncContractTree({ projectDir: tmp, ...resolveApiTree({ root: '../elsewhere' }, {}) })).toThrow(
      'the contract tree root "../elsewhere" (--root) must be a folder inside the project',
    );
    // the dev plugin, from the config
    const plugin = laratypeApi({ projectDir: tmp, config: () => ({ api: { root: '../x' } }) });
    await expect((plugin.resolveId as (source: string) => Promise<string | null>)('$api')).rejects.toThrow(
      '[laratype:api] the contract tree root "../x" (config api.root) must be a folder inside the project',
    );
    // an absolute root is rejected even when it points inside the project (emit uses the root as a path segment)
    // an absolute root is rejected even when it points inside the project (emit uses the root as a path segment)
    const inner = join(tmp, 'app', 'api').replace(/\\/g, '/');
    expect(() => syncContractTree({ projectDir: tmp, ...resolveApiTree({}, { root: inner }) })).toThrow(
      `the contract tree root "${inner}" (config api.root) must be a folder inside the project`,
    );
    expect(() => syncContractTree({ projectDir: tmp, ...resolveApiTree({ root: inner }, {}) })).toThrow('(--root) must be a folder inside the project');
    expect(() => syncContractTree({ projectDir: tmp, ...resolveApiTree({ root: 'C:/proj/app/api' }, {}) })).toThrow('the contract tree root "C:/proj/app/api" (--root) must be a folder inside the project');
    // a root that only passes through ".." but stays inside is fine
    expect(syncContractTree({ projectDir: tmp, root: 'app/../none' })).toBeUndefined();
  });

  it('shares one api.base rule with the scan', () => {
    const rule = 'must be "" or a path that starts with "/" and does not end with "/", such as "/api"';
    expect(() => apiTreeConfig({ api: { base: 'api' } })).toThrow(`config api.base ${rule}`);
    expect(() => scanFiles([], 'api')).toThrow(`base "api" ${rule}`);
  });

  it('validates api.root / api.base', () => {
    expect(apiTreeConfig({})).toEqual({});
    expect(apiTreeConfig(undefined)).toEqual({});
    expect(apiTreeConfig({ api: { root: 'app/contracts', base: '/v2' } })).toEqual({ root: 'app/contracts', base: '/v2' });
    expect(() => apiTreeConfig({ api: 'app/api' })).toThrow(ScanError);
    // context-neutral: the command adds "[sauf types:generate] ", the dev scan "[laratype:api] "
    expect(() => apiTreeConfig({ api: { root: '' } })).toThrow(/^config api\.root must be a folder, relative to the project$/);
    const badBase = 'config api.base must be "" or a path that starts with "/" and does not end with "/", such as "/api"';
    for (const base of [1, 'api', '/api/']) expect(() => apiTreeConfig({ api: { base } })).toThrow(badBase);
    expect(apiTreeConfig({ api: { base: '' } })).toEqual({ root: undefined, base: '' });
  });

  it('flags override the config, the config overrides the defaults', () => {
    expect(resolveApiTree({}, {})).toEqual({ root: 'app/api', base: '/api', rootSource: 'the default root' });
    expect(resolveApiTree({}, { root: 'app/contracts', base: '/v2' })).toEqual({ root: 'app/contracts', base: '/v2', rootSource: 'config api.root' });
    expect(resolveApiTree({ root: 'src/api', base: '' }, { root: 'app/contracts', base: '/v2' })).toEqual({ root: 'src/api', base: '', rootSource: '--root' });
  });

  it('a project without app/config/config.ts uses the defaults', async () => {
    expect(await readApiTreeConfig(join(tmp, 'none'))).toEqual({});
  });
});

describe('sauf types:generate reads the config key', () => {
  it('boots no provider', async () => {
    expect(await new TypesGenerateCommand().providers()).toEqual([]);
  });

  it('uses api.root / api.base from app/config/config.ts, importing that file only', async () => {
    const dir = project('config', "export default { name: 'x', api: { root: 'app/contracts', base: '/v2' } }\n", 'app/contracts');
    const { tree, files } = await runTypesGenerate(dir, {}, load);
    expect(tree.contracts.map((c) => [c.name, c.path])).toEqual([
      ['users', '/v2/users'],
      ['users.posts', '/v2/users/:user/posts'],
      ['v1.health', '/v2/v1/health'],
    ]);
    expect(files.map((f) => f.path)).toContain('.laratype/types/app/contracts/users/[user]/$types.d.ts');
  }, 60_000);

  it('types:generate does not load the app: no register(), so no $api import or dev scan before its own flags', async () => {
    expect(bootsApp(TypesGenerateCommand)).toBe(false);
    expect(bootsApp(class extends TypesGenerateCommand { static bootsApp = true; })).toBe(true);
    // a config whose tree is broken: --root other wins, the error is the command's, nothing is written
    const dir = project('broken-tree', "export default { api: { root: 'app/api' } }\n");
    writeFileSync(join(dir, 'app/api/bad.name.ts'), 'export {}\n');
    await expect(runTypesGenerate(dir, { root: 'other' }, load)).rejects.toThrow('the contract tree root "other" does not exist (set it with --root or config api.root)');
    expect(existsSync(join(dir, '.laratype'))).toBe(false);
    await expect(runTypesGenerate(dir, {}, load)).rejects.toThrow('file name "bad.name"');
  }, 60_000);

  it('with both --root and --base, app/config/config.ts is not imported at all', async () => {
    const dir = project('both-flags', "throw new Error('this config needs env and providers')\n");
    const load = async () => { throw new Error('the config must not be imported'); };
    const { tree } = await runTypesGenerate(dir, { root: 'app/api', base: '/v9' }, load);
    expect(tree.contracts[0]!.path).toBe('/v9/users');
    // one flag alone still reads the config for the other
    await expect(runTypesGenerate(dir, { root: 'app/api' }, load)).rejects.toThrow('the config must not be imported');
  }, 60_000);

  it('--root / --base override the config', async () => {
    const dir = project('flags', "export default { api: { root: 'app/contracts', base: '/v2' } }\n");
    const { tree } = await runTypesGenerate(dir, { root: 'app/api', base: '/api' }, load);
    expect(tree.contracts.map((c) => c.path)).toEqual(['/api/users', '/api/users/:user/posts', '/api/v1/health']);
  }, 60_000);
});

describe('laratype:api (the dev scan behind $api)', () => {
  it('scans the tree from the config on the first $api import and resolves the generated index', async () => {
    const dir = project('plugin', undefined, 'app/contracts');
    const plugin = laratypeApi({ projectDir: dir, config: () => ({ api: { root: 'app/contracts', base: '/v2' } }) });
    const resolveId = plugin.resolveId as (source: string) => Promise<string | null>;
    expect(await resolveId('zod')).toBeNull();
    const id = await resolveId('$api');
    expect(id).toBe(join(dir, '.laratype/api/index.gen.ts'));
    const index = readFileSync(id!, 'utf8');
    expect(index).toContain("'users.posts': { contract: c1, path: '/v2/users/:user/posts', scopes: [s0, s1], dirs: ['', 'users/[user]'] },");
    // the startup scan writes no api.ts (no TS checker)
    expect(existsSync(join(dir, '.laratype/api.ts'))).toBe(false);
    expect(existsSync(join(dir, '.laratype/types/app/contracts/users/[user]/$types.d.ts'))).toBe(true);
  });

  it('an app that never imports $api is never scanned, even on restart', async () => {
    const dir = project('unused', undefined);
    // a 0.5 helper in app/api that is not a valid tree file name
    writeFileSync(join(dir, 'app/api/user.service.ts'), 'export {}\n');
    const plugin = laratypeApi({ projectDir: dir, config: () => ({}) });
    await (plugin.api as ApiPluginApi).restart();
    expect(existsSync(join(dir, '.laratype'))).toBe(false);
  });

  it('a missing root fails the $api import, naming config api.root, instead of serving a stale index', async () => {
    const dir = project('stale', undefined);
    const plugin = laratypeApi({ projectDir: dir, config: () => ({}) });
    const resolveId = plugin.resolveId as (source: string) => Promise<string | null>;
    expect(await resolveId('$api')).toBe(join(dir, '.laratype/api/index.gen.ts'));
    rmSync(join(dir, 'app/api'), { recursive: true });
    await (plugin.api as ApiPluginApi).restart();
    await expect(resolveId('$api')).rejects.toThrow(
      '[laratype:api] the app imports $api, but the contract tree root "app/api" does not exist (set config api.root)',
    );
    const empty = join(tmp, 'empty');
    mkdirSync(empty, { recursive: true });
    await expect((laratypeApi({ projectDir: empty, config: () => ({}) }).resolveId as typeof resolveId)('$api')).rejects.toThrow('does not exist (set config api.root)');
    expect(existsSync(join(empty, '.laratype'))).toBe(false);
  });

  it('after a restart finds the root gone, the cached index is invalidated and its next load fails clearly', async () => {
    const dir = project('gone', undefined);
    const plugin = laratypeApi({ projectDir: dir, config: () => ({}) });
    const indexId = normalizePath(join(dir, '.laratype/api/index.gen.ts'));
    const invalidated: unknown[] = [];
    const mod = { id: indexId };
    (plugin.configureServer as (server: unknown) => void)({
      moduleGraph: { getModulesByFile: (file: string) => (file === indexId ? new Set([mod]) : undefined), invalidateModule: (m: unknown) => invalidated.push(m) },
    });
    const load = plugin.load as (id: string) => unknown;
    await (plugin.resolveId as (source: string) => Promise<string | null>)('$api');
    expect(load(join(dir, '.laratype/api/index.gen.ts'))).toBeNull();
    invalidated.length = 0;
    rmSync(join(dir, 'app/api'), { recursive: true });
    await (plugin.api as ApiPluginApi).restart();
    expect(invalidated).toEqual([mod]);
    // a cached importer loads the index by id, without resolving $api again
    expect(() => load(`${indexId}?t=1`)).toThrow('[laratype:api] the app imports $api, but the contract tree root "app/api" does not exist (set config api.root)');
    expect(load(join(dir, 'app/other.ts'))).toBeNull();
  });

  it('invalidates a rewritten index.gen.ts by its normalized module id', async () => {
    const dir = project('invalidate', undefined);
    const plugin = laratypeApi({ projectDir: dir, config: () => ({}) });
    const indexId = normalizePath(join(dir, '.laratype/api/index.gen.ts'));
    const lookups: string[] = [];
    const invalidated: unknown[] = [];
    const mod = { id: indexId };
    // the module graph is keyed by normalized ids (forward slashes on Windows too)
    const moduleGraph = {
      getModulesByFile: (file: string) => (lookups.push(file), file === indexId ? new Set([mod]) : undefined),
      invalidateModule: (m: unknown) => invalidated.push(m),
    };
    (plugin.configureServer as (server: unknown) => void)({ moduleGraph });
    await (plugin.resolveId as (source: string) => Promise<string | null>)('$api');
    expect(lookups).toEqual([indexId]);
    expect(lookups[0]).not.toContain('\\');
    expect(invalidated).toEqual([mod]);
    // unchanged tree: no write, no invalidation
    await (plugin.api as ApiPluginApi).restart();
    expect(invalidated).toHaveLength(1);
  });

  it('writes only the files whose content changed', () => {
    const dir = project('unchanged', undefined);
    const first = syncContractTree({ projectDir: dir })!;
    expect(first.changed).toContain('.laratype/api/index.gen.ts');
    const index = join(dir, '.laratype/api/index.gen.ts');
    const mtime = statSync(index).mtimeMs;
    const again = syncContractTree({ projectDir: dir })!;
    expect(again.changed).toEqual([]);
    expect(statSync(index).mtimeMs).toBe(mtime);
    // a deleted folder: its $types.d.ts goes, index.gen.ts is rewritten
    rmSync(join(dir, 'app/api/v1'), { recursive: true });
    expect(syncContractTree({ projectDir: dir })!.changed).toEqual(['.laratype/api/index.gen.ts', '.laratype/types/app/api/v1/health/$types.d.ts']);
  });

  it('rescans on every start and restart, and never caches a failed scan', async () => {
    const dir = project('rescan', undefined);
    let config: unknown = { api: { root: 'app/api', base: '/v1-typo/' } };
    const plugin = laratypeApi({ projectDir: dir, config: () => config });
    const api = plugin.api as ApiPluginApi;
    const resolveId = plugin.resolveId as (source: string) => Promise<string | null>;
    await expect(api.rescan()).rejects.toThrow('[laratype:api] config api.base must be ""');
    // the rejection is not cached: the fixed config applies on the next import
    config = { api: { base: '/api' } };
    const id = await resolveId('$api');
    expect(readFileSync(id!, 'utf8')).not.toContain('things');
    // a contract added between restarts shows up on the next rescan
    writeFileSync(join(dir, 'app/api/things.ts'), "export default {}\n");
    await contractTreePlugin([{ name: 'other' }, plugin])!.restart();
    expect(readFileSync(id!, 'utf8')).toContain("'things': { contract: c0, path: '/api/things', scopes: [s0], dirs: [''] },");
    // and goes away when deleted
    rmSync(join(dir, 'app/api/things.ts'));
    await api.restart();
    expect(readFileSync(id!, 'utf8')).not.toContain('things');
  });

  it('a config that imports $api fails clearly instead of waiting on its own scan', async () => {
    const dir = project('reentrant', undefined);
    let nested: Promise<string | null> | undefined;
    const plugin = laratypeApi({ projectDir: dir, config: () => { nested = resolveId('$api'); return {}; } });
    const resolveId = plugin.resolveId as (source: string) => Promise<string | null>;
    // the outer import completes; the nested one (from the config load) is rejected
    expect(await resolveId('$api')).toBe(join(dir, '.laratype/api/index.gen.ts'));
    await expect(nested).rejects.toThrow('[laratype:api] app/config/config.ts must not import $api (directly or indirectly)');
    // two imports racing the first scan, outside the config load, are both fine
    const fresh = laratypeApi({ projectDir: dir, config: () => ({}) }).resolveId as typeof resolveId;
    const [x, y] = await Promise.all([fresh('$api'), fresh('$api')]);
    expect(x).toBe(join(dir, '.laratype/api/index.gen.ts'));
    expect(y).toBe(x);
  });

  it('falls back to the default root when the first scan fails, so contract adds still restart', async () => {
    const dir = project('first-fails', undefined);
    const plugin = laratypeApi({ projectDir: dir, config: () => ({ api: { base: 'bad' } }) });
    const api = plugin.api as ApiPluginApi;
    await expect((plugin.resolveId as (source: string) => Promise<string | null>)('$api')).rejects.toThrow('[laratype:api] config api.base');
    expect(api.inTree(join(dir, 'app/api/new.ts'))).toBe(true);
    expect(shouldRestart('add', join(dir, 'app/api/new.ts'), api)).toBe(true);
  });

  it('tells the dev restart which files are in the tree and which are generated (its own outDir)', async () => {
    const dir = project('files', undefined);
    const plugin = laratypeApi({ projectDir: dir, outDir: 'gen', config: () => ({}) });
    const api = plugin.api as ApiPluginApi;
    // add/unlink of the config file can change the tree too
    expect(api.affectsTree('add', join(dir, 'app/config/config.ts'))).toBe(true);
    expect(api.affectsTree('unlink', join(dir, 'app/config/config.ts'))).toBe(true);
    // nothing is in the tree before the app imports $api
    expect(api.inTree(join(dir, 'app/api/new.ts'))).toBe(false);
    await (plugin.resolveId as (source: string) => Promise<string | null>)('$api');
    expect(api.inTree(join(dir, 'app/api/new.ts'))).toBe(true);
    expect(api.inTree(join(dir, 'app/api/users/[user]/_scope.ts'))).toBe(true);
    expect(api.inTree(join(dir, 'app/apis/x.ts'))).toBe(false);
    expect(api.isGenerated(join(dir, 'gen/api/index.gen.ts'))).toBe(true);
    expect(api.isGenerated(join(dir, '.laratype/api/index.gen.ts'))).toBe(false);
    expect(api.isGenerated(join(dir, 'app/api/users.ts'))).toBe(false);
    // only adding or deleting under the root, or touching the config, can change the tree
    expect(api.affectsTree('add', join(dir, 'app/api/new.ts'))).toBe(true);
    expect(api.affectsTree('unlink', join(dir, 'app/api/users.ts'))).toBe(true);
    expect(api.affectsTree('change', join(dir, 'app/api/users.ts'))).toBe(false);
    expect(api.affectsTree('change', join(dir, 'app/config/config.ts'))).toBe(true);
    expect(api.affectsTree('add', join(dir, 'app/src/new.ts'))).toBe(false);
    // only files the scan would read: no private folders, non-.ts files or editor temp files
    for (const file of ['app/api/_private/x.ts', 'app/api/$gen/x.ts', 'app/api/notes.md', 'app/api/users.ts~', 'app/api/users.ts.swp', 'app/api/users.d.ts', 'app/api/users.test.ts', 'app/api/_errors.ts']) {
      expect(api.inTree(join(dir, file))).toBe(false);
    }
    expect(api.inTree(join(dir, 'app/api/users/[user]/_scope.ts'))).toBe(true);
  });

  it('reads app/config/config.ts outside the app module graph, with the .env loaded first', async () => {
    const dir = project('plugin-file', [
      "import { base } from './base'",
      "export default { api: { root: 'app/contracts', base }, key: process.env.H1_APP_KEY }",
      '',
    ].join('\n'), 'app/contracts');
    // the config imports another module: with the app's loader that module could still be pending up the chain
    writeFileSync(join(dir, 'app/config/base.ts'), "export const base = process.env.H1_API_BASE ?? '/missing'\n");
    writeFileSync(join(dir, '.env'), 'H1_API_BASE=/v3\nH1_APP_KEY=from-dotenv\n');
    const vite: string[] = [];
    const previous = globalThis.__sauf_transpiler_instance;
    globalThis.__sauf_transpiler_instance = async (id: string) => { vite.push(id); throw new Error('the app loader must not be used'); };
    try {
      const id = await (laratypeApi({ projectDir: dir }).resolveId as (source: string) => Promise<string | null>)('$api');
      // the .env value reached the config the scan read
      expect(readFileSync(id!, 'utf8')).toContain("path: '/v3/users'");
      // the app's module cache was not used, so its later import of config.ts evaluates fresh, with env loaded
      expect(vite).toEqual([]);
      const fresh = (await isolatedImport(pathToFileURL(join(dir, 'app/config/config.ts')).href)) as { default: { key: string } };
      expect(fresh.default.key).toBe('from-dotenv');
    } finally {
      globalThis.__sauf_transpiler_instance = previous;
      delete process.env.H1_API_BASE;
      delete process.env.H1_APP_KEY;
    }
  });
});
