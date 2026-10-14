import { describe, expect, it } from 'vitest';
import { ScanError, emitApiIndex, emitTypesFile, isTreeFile, scanFiles } from '../../src/typegen';

// Scan rules of the contract folder tree (docs/v1/contract.md › Contract folder tree): names and paths only.

const names = (files: string[], base = '/api') => scanFiles(files, base).contracts.map((c) => [c.name, c.path, c.file]);

describe('scanFiles', () => {
  it('maps files to tree names and full paths', () => {
    expect(names(['users.ts', 'users/[user]/posts.ts', 'v1/health/index.ts'])).toEqual([
      ['users', '/api/users', 'users.ts'],
      ['users.posts', '/api/users/:user/posts', 'users/[user]/posts.ts'],
      ['v1.health', '/api/v1/health', 'v1/health/index.ts'],
    ]);
  });

  it('treats users.ts and users/index.ts as the same contract', () => {
    expect(names(['users/index.ts'])).toEqual([['users', '/api/users', 'users/index.ts']]);
    expect(() => scanFiles(['users.ts', 'users/index.ts'], '/api')).toThrow(
      'users.ts and users/index.ts are the same contract (/api/users): keep one',
    );
  });

  it('drops [x] folders from names but keeps them in paths', () => {
    expect(names(['teams/[team]/members/[member]/roles.ts'])).toEqual([
      ['teams.members.roles', '/api/teams/:team/members/:member/roles', 'teams/[team]/members/[member]/roles.ts'],
    ]);
    expect(names(['users/[user]/index.ts'])).toEqual([['users', '/api/users/:user', 'users/[user]/index.ts']]);
  });

  it('rejects two contracts with the same name', () => {
    expect(() => scanFiles(['users/posts.ts', 'users/[user]/posts.ts'], '/api')).toThrow(ScanError);
    expect(() => scanFiles(['users/posts.ts', 'users/[user]/posts.ts'], '/api')).toThrow(
      'users/[user]/posts.ts and users/posts.ts have the same name "users.posts" ([x] folders are dropped from names)',
    );
    expect(() => scanFiles(['users.ts', 'users/[user]/index.ts'], '/api')).toThrow(/have the same name "users"/);
  });

  it('collects _scope.ts chains, outer to inner, for contracts and folders', () => {
    const tree = scanFiles(['_scope.ts', 'users.ts', 'users/[user]/_scope.ts', 'users/[user]/posts.ts', 'users/[user]/likes/index.ts'], '/api');
    expect(tree.contracts.map((c) => [c.name, c.scopes])).toEqual([
      ['users', ['_scope.ts']],
      ['users.likes', ['_scope.ts', 'users/[user]/_scope.ts']],
      ['users.posts', ['_scope.ts', 'users/[user]/_scope.ts']],
    ]);
    expect(tree.folders).toEqual([
      { dir: '', path: '/api', scope: '_scope.ts', outerScopes: [] },
      { dir: 'users/[user]', path: '/api/users/:user', scope: 'users/[user]/_scope.ts', outerScopes: ['_scope.ts'] },
      { dir: 'users/[user]/likes', path: '/api/users/:user/likes', scope: undefined, outerScopes: ['_scope.ts', 'users/[user]/_scope.ts'] },
    ]);
  });

  it('keeps a folder that holds only a scope', () => {
    const tree = scanFiles(['admin/_scope.ts', 'admin/reports/index.ts'], '/api');
    expect(tree.folders.map((f) => f.dir)).toEqual(['admin', 'admin/reports']);
    expect(tree.contracts[0]!.scopes).toEqual(['admin/_scope.ts']);
  });

  it('reads _scope.ts as a scope but skips other _ and $ names, declarations and tests', () => {
    expect(isTreeFile('_scope.ts')).toBe(true);
    expect(isTreeFile('users/[user]/_scope.ts')).toBe(true);
    for (const file of ['_errors.ts', '$types.d.ts', 'users.d.ts', 'users.test.ts', 'users.spec.ts', '_shared/users.ts', '$x/users.ts', 'README.md', 'users.js']) {
      expect(isTreeFile(file), file).toBe(false);
    }
    const tree = scanFiles(['_scope.ts', '_errors.ts', '$types.d.ts', 'users.ts', 'users.test.ts', '_shared/helpers.ts'], '/api');
    expect(tree.contracts.map((c) => c.file)).toEqual(['users.ts']);
    expect(tree.folders[0]!.scope).toBe('_scope.ts');
  });

  it('rejects the root index.ts, which has no name', () => {
    expect(() => scanFiles(['index.ts'], '/api')).toThrow('index.ts: a contract needs a name; put it in a named folder (the root index.ts has none)');
    expect(() => scanFiles(['[id]/index.ts'], '/api')).toThrow(/a contract needs a name/);
  });

  it.each([['[[user]]'], ['[user?]'], ['[...rest]'], ['[]'], ['[1x]']])('rejects the param folder %s', (folder) => {
    expect(() => scanFiles([`users/${folder}/posts.ts`], '/api')).toThrow(
      `users/${folder}: "${folder}" is not a valid param folder: use [name]; optional and rest param folders are not supported`,
    );
  });

  it('rejects names that would break tree names or URLs', () => {
    expect(() => scanFiles(['users.admin.ts'], '/api')).toThrow(/file name "users.admin" may only use letters, digits/);
    expect(() => scanFiles(['my users/list.ts'], '/api')).toThrow(/folder name "my users" may only use letters, digits/);
  });

  it('accepts an empty base and normalizes Windows separators', () => {
    expect(names(['users\\[user]\\posts.ts'], '')).toEqual([['users.posts', '/users/:user/posts', 'users/[user]/posts.ts']]);
    expect(() => scanFiles(['users.ts'], 'api')).toThrow(/base "api" must be/);
    expect(() => scanFiles(['users.ts'], '/api/')).toThrow(/base "\/api\/" must be/);
  });

  it('sorts the output, whatever the input order', () => {
    expect(names(['z.ts', 'a/b.ts', 'a.ts']).map(([n]) => n)).toEqual(['a', 'a.b', 'z']);
  });
});

describe('emit', () => {
  const tree = scanFiles(['_scope.ts', 'users.ts', 'users/[user]/_scope.ts', 'users/[user]/posts.ts'], '/api');
  const options = { root: 'app/api', outDir: '.laratype' };

  it('writes Prefix and ScopePrefix per folder, with overlay-relative scope imports', () => {
    const file = emitTypesFile(tree.folders[1]!, options);
    expect(file.path).toBe('.laratype/types/app/api/users/[user]/$types.d.ts');
    expect(file.content).toContain(
      "export type Prefix = ContractPrefix<'/api/users/:user', [typeof import('../../_scope').default, typeof import('./_scope').default]>",
    );
    expect(file.content).toContain("export type ScopePrefix = ContractPrefix<'/api/users/:user', [typeof import('../../_scope').default]>");
  });

  it('writes index.gen.ts with one defineApi entry per contract', () => {
    const file = emitApiIndex(tree, options);
    expect(file.path).toBe('.laratype/api/index.gen.ts');
    expect(file.content).toContain("import s1 from '../../app/api/users/[user]/_scope'");
    expect(file.content).toContain("  'users.posts': { contract: c1, path: '/api/users/:user/posts', scopes: [s0, s1] },");
    expect(file.content).toContain('export type AppApi = typeof appApi');
    expect(emitApiIndex(scanFiles([], '/api'), options).content).toContain('export const appApi = defineApi({})');
  });
});
