import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import TypesGenerateCommand, { runTypesGenerate } from '../../src/commands/types/generate';
import { ScanError, apiTreeConfig, laratypeApi, readApiTreeConfig, resolveApiTree } from '../../src/typegen';

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
    expect(() => apiTreeConfig({ api: { root: '' } })).toThrow('[sauf types:generate] config api.root must be a folder, relative to the project');
    expect(() => apiTreeConfig({ api: { base: 1 } })).toThrow('config api.base must be a URL path');
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

  it('reads app/config/config.ts when the app config is not loaded yet', async () => {
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
