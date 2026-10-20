import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Console } from '@laratype/console';
import { getAppPath, setAppManifest, type AppManifest } from '@laratype/support';
import LaratypeBuildCommand, { loadBuildTypeScript, writeDistManifest } from '../../src/commands/build';
import { MANIFEST_FILE, useAppManifest } from '../../src/manifest';

/**
 * `sauf build`'s `dist/app.manifest.js` (B1 #125): each source points at the file TypeScript says tsc emitted for it
 * (`getOutputFileNames`), whatever the layout, and `appDir` records where `app/` went for the deprecated `getAppPath()`.
 */

let tmp: string;
const write = (dir: string, file: string, content = 'export default {};\n') => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
};

/** A project with `tsconfig.build.json` = `compilerOptions` + `extra`, compiled with tsc (the build's first step). */
const project = (name: string, compilerOptions: Record<string, unknown>, extra: Record<string, unknown> = {}, root = tmp) => {
  const dir = join(root, name);
  write(dir, 'app/config/config.ts', 'export default { name: "demo" };\n');
  write(dir, 'app/config/providers.ts', 'export default [];\n');
  write(dir, 'app/src/models/User.ts', 'export default class User {};\n');
  write(dir, 'app/database/factories/UserFactory.ts', 'export default class UserFactory {};\n');
  write(dir, 'database/seeders/DatabaseSeeder.ts', 'export default class DatabaseSeeder { layout = "v1" };\n');
  write(dir, 'tsconfig.build.json', JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'ES2022', moduleResolution: 'node', skipLibCheck: true, types: [], outDir: './dist', ...compilerOptions },
    include: ['app/**/*'],
    ...extra,
  }));
  const parsed = ts.getParsedCommandLineOfConfigFile(join(dir, 'tsconfig.build.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!;
  const result = ts.createProgram(parsed.fileNames, parsed.options).emit();
  expect(result.emitSkipped).toBe(false);
  return dir;
};

const load = async (file: string) => (await import(/* @vite-ignore */ pathToFileURL(file).href)).default as AppManifest;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'laratype-build-'));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('writeDistManifest', () => {
  it('the 0.5 build (include app/**, no rootDir: tsc roots at app/): dist/x.js, appDir ""', async () => {
    const dir = project('legacy', {});
    expect(existsSync(join(dir, 'dist/config/config.js'))).toBe(true);
    const { file, omitted } = writeDistManifest(ts, dir);
    const code = readFileSync(file, 'utf8');
    expect(code).toContain("path: 'app/config/config.ts', load: () => import('./config/config.js')");
    expect(code).toContain("  appDir: '',");
    expect(omitted).toEqual(['database/seeders/DatabaseSeeder.ts']);        // not in include
    const manifest = await load(file);
    expect((await manifest.configs[0]!.load()).default).toEqual({ name: 'demo' });
    expect(manifest.appDir).toBe('');
  });

  it('"rootDir": "." with database/** included: dist/app/x.js and dist/database/x.js, appDir "app"', async () => {
    const dir = project('tree', { rootDir: '.' }, { include: ['app/**/*', 'database/**/*'] });
    const { file, omitted } = writeDistManifest(ts, dir);
    const manifest = await load(file);
    expect(omitted).toEqual([]);
    expect(manifest.appDir).toBe('app');
    expect(readFileSync(file, 'utf8')).toContain("load: () => import('./database/seeders/DatabaseSeeder.js')");
    expect(new ((await manifest.seeders[0]!.load()).default)()).toMatchObject({ layout: 'v1' });
  });

  it('appDir comes from the config, not from the entries: "rootDir": "." with every app/** file excluded is still "app"', async () => {
    const dir = project('no-app', { rootDir: '.' }, { include: ['app/**/*', 'database/**/*'], exclude: ['app/**/*'] });
    const { file, omitted, appDir } = writeDistManifest(ts, dir);
    expect(appDir).toBe('app');
    expect(omitted).toContain('app/config/config.ts');
    expect((await load(file)).appDir).toBe('app');
  });

  it('an outDir other than dist: the manifest (next to the bundles in dist/) points into it', async () => {
    const dir = project('outdir', { rootDir: '.', outDir: './build' });
    mkdirSync(join(dir, 'dist'));
    const { file } = writeDistManifest(ts, dir);
    const manifest = await load(file);
    expect(readFileSync(file, 'utf8')).toContain("load: () => import('../build/app/config/config.js')");
    expect(manifest.appDir).toBe('../build/app');
    expect((await manifest.configs[0]!.load()).default).toEqual({ name: 'demo' });
  });

  it('a source excluded from the program is left out and reported, not an error', async () => {
    const dir = project('excluded', {}, { exclude: ['app/database/factories'] });
    const { file, omitted } = writeDistManifest(ts, dir);
    expect(omitted).toEqual(['database/seeders/DatabaseSeeder.ts', 'app/database/factories/UserFactory.ts']);
    expect((await load(file)).factories).toEqual([]);
  });

  it('a source in the program whose output is missing is an error', () => {
    const dir = project('missing', {});
    unlinkSync(join(dir, 'dist/src/models/User.js'));
    expect(() => writeDistManifest(ts, dir)).toThrow('sauf build: tsc emitted no file for app/src/models/User.ts (dist/src/models/User.js): run tsc -b tsconfig.build.json first');
  });
});

describe('getAppPath (deprecated) in production', () => {
  const previous = { prod: globalThis.__APP_PROD__, cwd: process.cwd(), manifest: (globalThis as { __laratype_manifest?: AppManifest }).__laratype_manifest };
  const base = { configs: [], routes: [], commands: [], models: [], migrations: [], seeders: [], factories: [], modules: [] } satisfies AppManifest;
  let dir: string;

  beforeAll(() => {
    dir = join(tmp, 'app-path');
    mkdirSync(join(dir, 'dist/app/database/seeders'), { recursive: true });
    mkdirSync(join(dir, 'dist/database/seeders'), { recursive: true });
  });

  afterEach(() => {
    globalThis.__APP_PROD__ = previous.prod;
    process.chdir(previous.cwd);
    if (previous.manifest) setAppManifest(previous.manifest);
    else delete (globalThis as { __laratype_manifest?: AppManifest }).__laratype_manifest;
  });

  it('resolves against the appDir sauf build recorded, globs and folders included; dist/<path> without one', () => {
    globalThis.__APP_PROD__ = true;
    process.chdir(dir);
    setAppManifest({ ...base, appDir: 'app' });
    expect(getAppPath('src/models/*', false)).toBe(join(dir, 'dist', 'app', 'src', 'models', '*'));
    // database/seeders exists in both layouts' places: the recorded one wins, no probing
    expect(getAppPath('database/seeders', false)).toBe(join(dir, 'dist', 'app', 'database', 'seeders'));
    expect(getAppPath('/config/config.ts', false)).toBe(join(dir, 'dist', 'app', 'config', 'config.js'));
    setAppManifest({ ...base, appDir: '' });
    expect(getAppPath('src/models/*', false)).toBe(join(dir, 'dist', 'src', 'models', '*'));
    delete (globalThis as { __laratype_manifest?: AppManifest }).__laratype_manifest;
    expect(getAppPath('/config/config.ts', false)).toBe(join(dir, 'dist', 'config', 'config.js'));
  });
});

describe('sauf build', () => {
  it('needs typescript: a clear error when it is missing', async () => {
    await expect(loadBuildTypeScript(() => Promise.reject(new Error("Cannot find package 'typescript'")))).rejects.toThrow(
      'sauf build needs typescript (install it as a devDependency)',
    );
    expect(await loadBuildTypeScript(async () => ({ default: ts }))).toBe(ts);
  });

  it('a missing dist/app.manifest.js in production says to run sauf build', async () => {
    const prod = globalThis.__APP_PROD__;
    globalThis.__APP_PROD__ = true;
    try {
      const notFound = Object.assign(new Error(`Cannot find module '/app/dist/${MANIFEST_FILE}' imported from /app/dist/index.js`), { code: 'ERR_MODULE_NOT_FOUND' });
      await expect(useAppManifest(() => Promise.reject(notFound))).rejects.toThrow(`dist/${MANIFEST_FILE} not found: run \`sauf build\``);
      // Another missing module, imported by the manifest: its own error
      const other = Object.assign(new Error("Cannot find module '/app/dist/app/config/config.js'"), { code: 'ERR_MODULE_NOT_FOUND' });
      await expect(useAppManifest(() => Promise.reject(other))).rejects.toBe(other);
    } finally {
      globalThis.__APP_PROD__ = prod;
    }
  });

  it('a failed manifest step leaves no stale app.manifest.js and copies no bundles', async () => {
    const cwd = process.cwd();
    // Inside the repo: the platform adapter (sauf/resources) resolves from the project
    const root = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), '.cli-build-'));
    const info = vi.spyOn(Console, 'info').mockImplementation(() => {});
    const start = vi.spyOn(Console, 'start').mockImplementation(() => {});
    try {
      const dir = project('app', {}, {}, root);
      write(dir, 'package.json', '{ "name": "build-fixture", "version": "0.0.0" }');
      write(dir, `dist/${MANIFEST_FILE}`, '// an old manifest\n');
      unlinkSync(join(dir, 'dist/src/models/User.js'));
      process.chdir(dir);
      const command = new LaratypeBuildCommand();
      command.opts = () => ({ platform: 'node' });
      await expect(command.handle()).rejects.toThrow('sauf build: tsc emitted no file for app/src/models/User.ts');
      expect(existsSync(join(dir, 'dist', MANIFEST_FILE))).toBe(false);
      expect(existsSync(join(dir, 'dist', 'index.js'))).toBe(false);
      expect(existsSync(join(dir, 'dist', 'cli.js'))).toBe(false);
    } finally {
      process.chdir(cwd);
      info.mockRestore();
      start.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
