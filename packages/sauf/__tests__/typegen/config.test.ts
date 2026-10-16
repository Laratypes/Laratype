import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import TypesGenerateCommand, { runTypesGenerate } from '../../src/commands/types/generate';
import { ScanError, apiTreeConfig, laratypeApi, readApiTreeConfig, resolveApiTree, rescanContractTree, syncContractTree } from '../../src/typegen';
import type { ApiPluginApi } from '../../src/typegen';
import { isGeneratedFile } from '../../src/commands/dev';

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

  it('skips an app without a contract tree', async () => {
    const dir = join(tmp, 'empty');
    mkdirSync(dir, { recursive: true });
    const plugin = laratypeApi({ projectDir: dir, config: () => ({}) });
    expect(await (plugin.resolveId as (source: string) => Promise<string | null>)('$api')).toBeNull();
    expect(existsSync(join(dir, '.laratype'))).toBe(false);
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
    await rescanContractTree([{ name: 'other' }, plugin]);
    expect(readFileSync(id!, 'utf8')).toContain("'things': { contract: c0, path: '/api/things', scopes: [s0], dirs: [''] },");
  });

  it('the dev restart ignores .laratype writes', () => {
    expect(isGeneratedFile(String.raw`D:\app\.laratype\api\index.gen.ts`)).toBe(true);
    expect(isGeneratedFile('/app/.laratype/types/app/api/$types.d.ts')).toBe(true);
    expect(isGeneratedFile('/app/app/api/users.ts')).toBe(false);
    expect(isGeneratedFile('/app/app/my.laratype.ts')).toBe(false);
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
