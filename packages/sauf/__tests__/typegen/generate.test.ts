import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScanError, TypeScriptMissingError, generateTypes, loadTypeScript } from '../../src/typegen';
import type { GenerateResult } from '../../src/typegen';

/**
 * End to end (G1 #133): copy fixtures/project to a tmp dir, run the generator, then compile
 * - the app (contract files + `.laratype`) through the rootDirs overlay and the `$api` alias, and
 * - a separate FE project (fixtures/fe) against the generated api.ts only: `types: []`, DOM lib, no contract lib.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\\/g, '/');
const fixtures = join(here, 'fixtures');

const appTsconfig = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    strict: true,
    verbatimModuleSyntax: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
    lib: ['ES2022', 'DOM'],
    // What an app adds for the generated files (docs/v1/typegen.md)
    rootDirs: ['.', '.laratype/types'],
    paths: {
      $api: ['./.laratype/api/index.gen.ts'],
      // the tmp project sits outside the repo: point at the workspace sources
      '@laratype/contract': [`${repo}packages/contract/src/index.ts`],
      zod: [`${repo}node_modules/zod`],
    },
  },
  include: ['app', '.laratype', 'checks'],
};

const format = (diagnostics: readonly ts.Diagnostic[], cwd: string) =>
  diagnostics.map((d) => ts.formatDiagnostic(d, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => cwd, getNewLine: () => '\n' }));

const compileProject = (dir: string) => {
  const { config } = ts.readConfigFile(join(dir, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, dir);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  return { program, diagnostics: format(ts.getPreEmitDiagnostics(program), dir) };
};

let tmp: string;
let project: string;
let result: GenerateResult;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'laratype-typegen-'));
  project = join(tmp, 'project');
  cpSync(join(fixtures, 'project'), project, { recursive: true });
  writeFileSync(join(project, 'tsconfig.json'), JSON.stringify(appTsconfig, null, 2));
  result = await generateTypes({ projectDir: project }, ts);
}, 60_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('sauf types:generate', () => {
  it('writes one $types.d.ts per folder, index.gen.ts and api.ts', () => {
    expect(result.files.map((f) => f.path)).toEqual([
      '.laratype/types/app/api/$types.d.ts',
      '.laratype/types/app/api/users/[user]/$types.d.ts',
      '.laratype/types/app/api/v1/health/$types.d.ts',
      '.laratype/api/index.gen.ts',
      '.laratype/api.ts',
    ]);
    expect(result.tree.contracts.map((c) => c.name)).toEqual(['users', 'users.posts', 'v1.health']);
    for (const file of result.files) expect(readFileSync(join(project, file.path), 'utf8')).toBe(file.content);
  });

  it('matches the snapshots', async () => {
    for (const file of result.files) {
      await expect(file.content).toMatchFileSnapshot(`__snapshots__/${file.path.replace(/^\.laratype\//, '')}`);
    }
  });

  it('the app compiles through the rootDirs overlay and the $api alias', () => {
    mkdirSync(join(project, 'checks'), { recursive: true });
    writeFileSync(
      join(project, 'checks', 'api.ts'),
      [
        "import type { ApiShape, ApiTypes } from '@laratype/contract'",
        "import { appApi } from '$api'",
        "import type { AppApi } from '$api'",
        "import type { AppApi as Generated } from '../.laratype/api'",
        '',
        '// the generated alias is the projection of the real contracts, both ways',
        'export const a: Generated = null! as ApiTypes<AppApi>',
        'export const b: ApiTypes<AppApi> = null! as Generated',
        '// and it satisfies the client constraint',
        'declare function client<A extends ApiShape<A>>(): A',
        'export const c = client<Generated>()',
        'export const update = appApi.users.posts.update',
      ].join('\n'),
    );
    const { diagnostics } = compileProject(project);
    expect(diagnostics).toEqual([]);
  }, 60_000);

  it('a separate FE compiles against api.ts alone (no contract lib, no zod)', () => {
    const fe = join(tmp, 'fe');
    cpSync(join(fixtures, 'fe'), fe, { recursive: true });
    mkdirSync(join(fe, 'generated'), { recursive: true });
    cpSync(join(project, '.laratype', 'api.ts'), join(fe, 'generated', 'api.ts'));

    const api = readFileSync(join(fe, 'generated', 'api.ts'), 'utf8');
    expect(api).not.toMatch(/^\s*import\b/m);
    expect(api).not.toMatch(/zod|@laratype|import\(/);

    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      types: [],
    };
    const program = ts.createProgram([join(fe, 'src', 'main.ts')], options);
    expect(format(ts.getPreEmitDiagnostics(program), fe)).toEqual([]);
    const feDir = fe.replace(/\\/g, '/');
    const outside = program
      .getSourceFiles()
      .map((sf) => sf.fileName)
      .filter((f) => !f.startsWith(feDir) && !/\/typescript\/lib\/lib\.[^/]+\.d\.ts$/.test(f));
    expect(outside).toEqual([]);
    expect(program.getSourceFiles().filter((sf) => sf.fileName.startsWith(feDir)).map((sf) => sf.fileName.slice(feDir.length))).toEqual([
      '/generated/api.ts',
      '/src/main.ts',
    ]);
  }, 60_000);

  it('writes the manifest: route name → method, full path, sorted error codes', () => {
    const api = result.files.find((f) => f.path === '.laratype/api.ts')!.content;
    expect(api).toContain(
      "  'users.posts.update': { method: 'patch', path: '/api/users/:user/posts/:post', errors: ['ACCOUNT_LOCKED', 'FORBIDDEN', 'NOT_FOUND', 'TOO_MANY_REQUESTS', 'UNAUTHORIZED', 'VALIDATION_ERROR'] },",
    );
    expect(api).toContain("  'v1.health.check': { method: 'get', path: '/api/v1/health', errors: [] },");
  });

  it('inlines named types (interfaces, contract error bodies) and keeps default-lib ones', () => {
    const api = result.files.find((f) => f.path === '.laratype/api.ts')!.content;
    expect(api).not.toMatch(/MessageBody|ValidationErrorBody|Address\b|ZodType/);
    expect(api).toContain('createdAt: Date;');
    expect(api).toContain('meta: Record<string, boolean>;');
    expect(api).toContain('pair: [number, string];');
    expect(api).toContain('zip?: string | undefined;');
  });

  it('removes the $types.d.ts of a deleted folder on the next run', async () => {
    const copy = join(tmp, 'rerun');
    cpSync(project, copy, { recursive: true });
    rmSync(join(copy, 'app', 'api', 'v1'), { recursive: true });
    const again = await generateTypes({ projectDir: copy }, ts);
    expect(again.tree.contracts.map((c) => c.name)).toEqual(['users', 'users.posts']);
    expect(existsSync(join(copy, '.laratype', 'types', 'app', 'api', 'v1'))).toBe(false);
  }, 60_000);

  it('keeps non-generated files under --out', async () => {
    const copy = join(tmp, 'keep');
    cpSync(project, copy, { recursive: true });
    const own = join(copy, '.laratype', 'types', 'app', 'api', 'v1', 'notes.md');
    writeFileSync(own, 'mine');
    rmSync(join(copy, 'app', 'api', 'v1'), { recursive: true });
    await generateTypes({ projectDir: copy }, ts);
    expect(readFileSync(own, 'utf8')).toBe('mine');
    expect(existsSync(join(copy, '.laratype', 'types', 'app', 'api', 'v1', 'health'))).toBe(false);
    expect(existsSync(join(copy, '.laratype', 'types', 'app', 'api', 'users', '[user]', '$types.d.ts'))).toBe(true);
  }, 60_000);

  it.each([['.'], ['..'], ['../elsewhere'], ['app'], ['app/api']])('rejects --out %s', async (outDir) => {
    await expect(generateTypes({ projectDir: project, outDir }, ts)).rejects.toThrow(ScanError);
    expect(existsSync(join(project, 'app', 'api', 'users.ts'))).toBe(true);
  });

  it('honours --root, --base, --out and --api-out', async () => {
    const copy = join(tmp, 'options');
    mkdirSync(copy);
    cpSync(join(fixtures, 'project', 'app', 'api'), join(copy, 'src', 'routes'), { recursive: true });
    writeFileSync(join(copy, 'tsconfig.json'), JSON.stringify({ ...appTsconfig, include: ['src', 'gen'] }));
    const r = await generateTypes({ projectDir: copy, root: 'src/routes', base: '/v2', outDir: 'gen', apiOut: 'fe/api.ts' }, ts);
    expect(r.files.map((f) => f.path)).toContain('gen/types/src/routes/users/[user]/$types.d.ts');
    expect(r.files.at(-1)!.path).toBe('fe/api.ts');
    expect(readFileSync(join(copy, 'gen', 'api', 'index.gen.ts'), 'utf8')).toContain("import c0 from '../../src/routes/users'");
    expect(readFileSync(join(copy, 'fe', 'api.ts'), 'utf8')).toContain("path: '/v2/users/:user/posts'");
  }, 60_000);

  it('accepts --root . (the project itself) and skips the output folder inside it', async () => {
    const copy = join(tmp, 'root-dot');
    mkdirSync(copy);
    cpSync(join(fixtures, 'project', 'app', 'api'), copy, { recursive: true });
    writeFileSync(join(copy, 'tsconfig.json'), JSON.stringify({ ...appTsconfig, include: ['.'] }));
    const first = await generateTypes({ projectDir: copy, root: '.' }, ts);
    // a second run sees .laratype inside the root: its generated files are not contracts
    const second = await generateTypes({ projectDir: copy, root: '.' }, ts);
    expect(second.tree).toEqual(first.tree);
    expect(second.tree.contracts.map((c) => c.name)).toEqual(['users', 'users.posts', 'v1.health']);
    expect(second.files.map((f) => f.path)).toContain('.laratype/types/users/[user]/$types.d.ts');
    expect(readFileSync(join(copy, '.laratype', 'api', 'index.gen.ts'), 'utf8')).toContain("import c0 from '../../users'");
  }, 60_000);

  it('fails on an invalid tree before writing anything', async () => {
    const copy = join(tmp, 'invalid');
    cpSync(join(fixtures, 'project'), copy, { recursive: true });
    writeFileSync(join(copy, 'app', 'api', 'users', 'index.ts'), 'export {}\n');
    await expect(generateTypes({ projectDir: copy }, ts)).rejects.toThrow(ScanError);
    expect(existsSync(join(copy, '.laratype'))).toBe(false);
  });

  it('needs strictNullChecks: without it the contract types do not resolve', async () => {
    const copy = join(tmp, 'loose');
    cpSync(join(fixtures, 'project'), copy, { recursive: true });
    const loose = { ...appTsconfig, compilerOptions: { ...appTsconfig.compilerOptions, strict: false } };
    writeFileSync(join(copy, 'tsconfig.json'), JSON.stringify(loose));
    await expect(generateTypes({ projectDir: copy }, ts)).rejects.toThrow(/the contract types need strictNullChecks: set "strict": true in .*tsconfig\.json/);
  });

  it('fails clearly when the root folder does not exist', async () => {
    await expect(generateTypes({ projectDir: tmp, root: 'nope/api' }, ts)).rejects.toThrow(
      'the contract tree root "nope/api" does not exist (set it with --root or config api.root)',
    );
  });

  it('reports contract type errors with their location', async () => {
    const copy = join(tmp, 'broken');
    cpSync(project, copy, { recursive: true });
    writeFileSync(join(copy, 'app', 'api', 'broken.ts'), "import { defineContract } from '@laratype/contract'\nexport default defineContract()({ x: 1 })\n");
    await expect(generateTypes({ projectDir: copy }, ts)).rejects.toThrow(/the contract tree does not type-check:\napp\/api\/broken\.ts\(2,/);
  }, 60_000);
});

describe('loadTypeScript', () => {
  it('loads the typescript package', async () => {
    expect((await loadTypeScript()).version).toBe(ts.version);
  });

  it('fails with a clear message when typescript is not installed', async () => {
    const missing = () => Promise.reject(Object.assign(new Error("Cannot find package 'typescript'"), { code: 'ERR_MODULE_NOT_FOUND' }));
    await expect(loadTypeScript(missing)).rejects.toThrow(TypeScriptMissingError);
    await expect(loadTypeScript(missing)).rejects.toThrow(
      '[sauf types:generate] sauf types:generate needs the typescript package (>=5): add it to the project\'s devDependencies',
    );
  });
});
