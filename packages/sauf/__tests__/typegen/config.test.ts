import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import TypesGenerateCommand, { runTypesGenerate } from '../../src/commands/types/generate';
import { normalizePath } from 'vite';
import { ScanError, apiTreeConfig, contractTreePlugin, laratypeApi, readApiTreeConfig, resolveApiTree, syncContractTree } from '../../src/typegen';
import type { ApiPluginApi } from '../../src/typegen';

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
    expect(resolveApiTree({}, {})).toEqual({ root: 'app/api', base: '/api' });
    expect(resolveApiTree({}, { root: 'app/contracts', base: '/v2' })).toEqual({ root: 'app/contracts', base: '/v2' });
    expect(resolveApiTree({ root: 'src/api', base: '' }, { root: 'app/contracts', base: '/v2' })).toEqual({ root: 'src/api', base: '' });
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

  it('tells the dev restart which files are in the tree and which are generated (its own outDir)', async () => {
    const dir = project('files', undefined);
    const plugin = laratypeApi({ projectDir: dir, outDir: 'gen', config: () => ({}) });
    const api = plugin.api as ApiPluginApi;
    // nothing is in the tree before the app imports $api
    expect(api.inTree(join(dir, 'app/api/new.ts'))).toBe(false);
    await (plugin.resolveId as (source: string) => Promise<string | null>)('$api');
    expect(api.inTree(join(dir, 'app/api/new.ts'))).toBe(true);
    expect(api.inTree(join(dir, 'app/api/users/[user]/_scope.ts'))).toBe(true);
    expect(api.inTree(join(dir, 'app/apis/x.ts'))).toBe(false);
    expect(api.isGenerated(join(dir, 'gen/api/index.gen.ts'))).toBe(true);
    expect(api.isGenerated(join(dir, '.laratype/api/index.gen.ts'))).toBe(false);
    expect(api.isGenerated(join(dir, 'app/api/users.ts'))).toBe(false);
  });

  it('reads app/config/config.ts on its own', async () => {
    const dir = project('plugin-file', "export default { api: { root: 'app/contracts', base: '/v3' } }\n", 'app/contracts');
    const previous = globalThis.__sauf_transpiler_instance;
    globalThis.__sauf_transpiler_instance = load;
    try {
      const id = await (laratypeApi({ projectDir: dir }).resolveId as (source: string) => Promise<string | null>)('$api');
      expect(readFileSync(id!, 'utf8')).toContain("path: '/v3/users'");
    } finally {
      globalThis.__sauf_transpiler_instance = previous;
    }
  });
});
