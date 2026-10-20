import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Console } from '@laratype/console';
import { appManifest, emittedPaths, getAppPath, setAppManifest, type AppManifest } from '@laratype/support';
import {
  emitManifest, inManifestDirs, isManifestFile, laratypeManifest, MANIFEST_DIRS, MANIFEST_FILE, MANIFEST_ID, ManifestScanError,
  scanManifest, useAppManifest, writeDistManifest, type ScannedManifest,
} from '../../src/manifest';
import SeedDatabaseCommand from '../../src/commands/db/seed';
import { shouldRestart } from '../../src/utils/restarter';

/**
 * B1 #125: the app manifest (`virtual:laratype/app` in dev, `dist/app.manifest.js` after `sauf build`) replaces the
 * runtime path discovery of providers, configs, routes, commands, models, migrations and seeders.
 */

let tmp: string;
const write = (dir: string, file: string, content = 'export default {};\n') => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
};

/** A project with files of both layouts: 0.5 (`app/src/...`, `app/database/...`) and v1 (`app/models`, `database/...`). */
const project = (name: string) => {
  const dir = join(tmp, name);
  write(dir, 'app/config/config.ts', 'export default { name: "demo" };\n');
  write(dir, 'app/config/auth.ts');
  write(dir, 'app/config/providers.ts', 'export default ["P"];\n');
  write(dir, 'app/routes/api.ts');
  write(dir, 'app/routes/console.ts', 'export default [];\n');
  write(dir, 'app/routes/user/user.ts');                 // nested route groups are imported by api.ts, not discovered
  write(dir, 'app/src/console/commands/SendMail.ts', 'export default class SendMail {};\n');
  write(dir, 'app/src/models/User.ts', 'export default class User {};\n');
  write(dir, 'app/src/models/User.test.ts');             // not a module
  write(dir, 'app/src/models/Shape.d.ts');               // not a module
  write(dir, 'app/src/models/Legacy.js', 'export class Legacy {};\n');
  write(dir, 'app/models/Post.ts', 'export class Post {};\n');
  write(dir, 'app/models/Tag.mts', 'export class Tag {};\n');
  write(dir, 'app/database/seeders/DatabaseSeeder.ts', 'export default class DatabaseSeeder { layout = "0.5" };\n');
  write(dir, 'app/database/seeders/Admin/UserSeeder.ts', 'export default class UserSeeder { layout = "0.5 nested" };\n');
  write(dir, 'database/seeders/PostSeeder.ts', 'export default class PostSeeder { layout = "v1" };\n');
  write(dir, 'database/migrations/2026_01_02_posts.ts');
  write(dir, 'database/migrations/2026_01_01_users.ts');
  write(dir, 'app/modules/billing/index.ts');
  write(dir, 'app/modules/notes.ts');                    // a module is a folder with an index.ts
  return dir;
};

const paths = (scan: ScannedManifest) => Object.fromEntries(Object.entries(scan.kinds).map(([kind, entries]) => [kind, entries.map((e) => e.path)]));

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'laratype-manifest-'));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('scanManifest', () => {
  it('finds every kind in both layouts, the 0.5 one first, sorted by name', () => {
    const scan = scanManifest(project('scan'));
    expect(scan.providers).toEqual({ name: 'providers', path: 'app/config/providers.ts' });
    expect(paths(scan)).toEqual({
      configs: ['app/config/auth.ts', 'app/config/config.ts'],
      routes: ['app/routes/api.ts', 'app/routes/console.ts'],
      commands: ['app/src/console/commands/SendMail.ts'],
      models: ['app/src/models/Legacy.js', 'app/src/models/User.ts', 'app/models/Post.ts', 'app/models/Tag.mts'],
      migrations: ['database/migrations/2026_01_01_users.ts', 'database/migrations/2026_01_02_posts.ts'],
      seeders: ['app/database/seeders/Admin/UserSeeder.ts', 'app/database/seeders/DatabaseSeeder.ts', 'database/seeders/PostSeeder.ts'],
      factories: [],
      modules: ['app/modules/billing/index.ts'],
    });
    expect(scan.kinds.models.map((e) => e.name)).toEqual(['Legacy', 'User', 'Post', 'Tag']);
    expect(scan.kinds.modules[0].name).toBe('billing');
  });

  it('names seeders by their path in the seeders folder, as db:seed --class takes them', () => {
    expect(scanManifest(join(tmp, 'scan')).kinds.seeders.map((e) => e.name)).toEqual(['Admin/UserSeeder', 'DatabaseSeeder', 'PostSeeder']);
  });

  it('a name in both layouts of one kind is a scan error', () => {
    const dir = join(tmp, 'duplicate');
    write(dir, 'app/src/models/User.ts');
    write(dir, 'app/models/User.ts');
    expect(() => scanManifest(dir)).toThrow(ManifestScanError);
    expect(() => scanManifest(dir)).toThrow('models/User is in both app/src/models/User.ts and app/models/User.ts: rename or remove one');
  });

  it('skips folders that do not exist, and has no providers entry without app/config/providers.ts', () => {
    const dir = join(tmp, 'empty');
    mkdirSync(dir);
    const scan = scanManifest(dir);
    expect(scan.providers).toBeUndefined();
    expect(Object.values(scan.kinds).every((entries) => entries.length === 0)).toBe(true);
  });

  it('inManifestDirs / isManifestFile: a module file under one of the discovery folders', () => {
    expect(inManifestDirs('app/src/models/Tag.ts')).toBe(true);
    expect(inManifestDirs('database\\seeders\\X.ts')).toBe(true);
    expect(inManifestDirs('app/src/http/controllers/X.ts')).toBe(false);
    expect(isManifestFile('/p', '/p/database/seeders/Admin/X.ts')).toBe(true);
    expect(isManifestFile('/p', '/p/app/models/X.mjs')).toBe(true);
    expect(isManifestFile('/p', '/p/app/models/X.ts~')).toBe(false);
    expect(isManifestFile('/p', '/p/app/models/X.d.ts')).toBe(false);
    expect(isManifestFile('/p', '/other/app/models/X.ts')).toBe(false);
    expect(Object.keys(MANIFEST_DIRS)).toEqual(['configs', 'routes', 'commands', 'models', 'migrations', 'seeders', 'factories', 'modules']);
  });
});

describe('emitManifest', () => {
  it('writes one lazy loader with a literal specifier per entry', () => {
    const code = emitManifest(
      { providers: { name: 'providers', path: 'app/config/providers.ts' }, kinds: { ...scanManifest(join(tmp, 'empty')).kinds, models: [{ name: "O'Neil", path: "app/models/O'Neil.ts" }] } },
      (path) => `./${path.replace(/\.ts$/, '.js')}`,
    );
    expect(code).toMatchInlineSnapshot(`
      "// Generated by sauf (laratype:manifest, docs/v1/build.md › Plugin chain). Do not edit.
      export default {
        providers: { name: 'providers', path: 'app/config/providers.ts', load: () => import('./app/config/providers.js') },
        configs: [],
        routes: [],
        commands: [],
        models: [
          { name: 'O\\'Neil', path: 'app/models/O\\'Neil.ts', load: () => import('./app/models/O\\'Neil.js') },
        ],
        migrations: [],
        seeders: [],
        factories: [],
        modules: [],
      };
      "
    `);
  });
});

describe('laratype:manifest (dev)', () => {
  let server: ViteDevServer;
  let dir: string;

  beforeAll(async () => {
    dir = project('dev');
    server = await createServer({
      root: dir,
      configFile: false,
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true },
      plugins: [laratypeManifest({ projectDir: dir })],
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('serves virtual:laratype/app, whose loaders import the source files through Vite', async () => {
    const manifest = await useAppManifest((id) => server.ssrLoadModule(id));
    expect(appManifest()).toBe(manifest);
    expect(manifest.configs.map((e) => e.name)).toEqual(['auth', 'config']);
    expect((await manifest.configs[1].load()).default).toEqual({ name: 'demo' });
    expect((await manifest.providers!.load()).default).toEqual(['P']);
    expect(Object.keys(await manifest.models[2].load())).toEqual(['Post']);
  });

  it('invalidates the module when a file is added to or deleted from a manifest folder', async () => {
    const before = (await server.ssrLoadModule(MANIFEST_ID)).default as AppManifest;
    write(dir, 'app/src/models/Zebra.ts');
    server.watcher.emit('add', join(dir, 'app/src/models/Zebra.ts'));
    const added = (await server.ssrLoadModule(MANIFEST_ID)).default as AppManifest;
    expect(added).not.toBe(before);
    expect(added.models.map((e) => e.name)).toEqual(['Legacy', 'User', 'Zebra', 'Post', 'Tag']);

    unlinkSync(join(dir, 'app/src/models/Zebra.ts'));
    server.watcher.emit('unlink', join(dir, 'app/src/models/Zebra.ts'));
    expect(((await server.ssrLoadModule(MANIFEST_ID)).default as AppManifest).models.map((e) => e.name)).toEqual(['Legacy', 'User', 'Post', 'Tag']);

    // Elsewhere: the cached module stays
    const cached = (await server.ssrLoadModule(MANIFEST_ID)).default;
    server.watcher.emit('add', join(dir, 'app/src/http/X.ts'));
    expect((await server.ssrLoadModule(MANIFEST_ID)).default).toBe(cached);
  });
});

describe('shouldRestart (sauf dev --hmr)', () => {
  const inManifest = (file: string) => isManifestFile('/p', file);

  it('restarts when a file is added to or deleted from a manifest folder, so the app boots with the new list', () => {
    expect(shouldRestart('add', '/p/app/src/models/Tag.ts', undefined, inManifest)).toBe(true);
    expect(shouldRestart('unlink', '/p/database/seeders/X.ts', undefined, inManifest)).toBe(true);
    expect(shouldRestart('add', '/p/app/src/http/X.ts', undefined, inManifest)).toBe(false);
    expect(shouldRestart('add', '/p/app/src/models/Tag.ts', undefined)).toBe(false);
  });
});

/** Writes what tsc would emit for every source of `dir`, at `emittedPaths()[layout]` (0: `rootDir: "."`, 1: the 0.5 build). */
const emit = (dir: string, layout: 0 | 1) => {
  const scan = scanManifest(dir);
  for (const entry of [scan.providers!, ...Object.values(scan.kinds).flat()]) {
    const out = emittedPaths(entry.path);
    write(dir, join('dist', out[layout] ?? out[0]!), readFileSync(join(dir, entry.path), 'utf8'));
  }
};

describe('writeDistManifest (sauf build)', () => {
  it('points every entry at the file tsc emitted under dist/app ("rootDir": "."), and loads in plain Node', async () => {
    const dir = project('dist');
    emit(dir, 0);
    const file = writeDistManifest(dir);
    expect(file).toBe(join(dir, 'dist', MANIFEST_FILE));
    const code = readFileSync(file, 'utf8');
    expect(code).toContain("load: () => import('./app/src/models/User.js')");
    expect(code).toContain("load: () => import('./app/models/Tag.mjs')");
    expect(code).toContain("load: () => import('./database/seeders/PostSeeder.js')");
    expect(code).not.toContain('.ts\')');

    const { default: manifest } = await import(/* @vite-ignore */ pathToFileURL(file).href) as { default: AppManifest };
    const seeders = await Promise.all(manifest.seeders.map(async (e) => new ((await e.load()).default)().layout));
    expect(seeders).toEqual(['0.5 nested', '0.5', 'v1']);
  });

  it('supports the 0.5 build, where tsc emits app/x.ts as dist/x.js (include: ["app/**/*"], no rootDir)', async () => {
    const dir = join(tmp, 'legacy');
    write(dir, 'app/config/config.ts', 'export default { name: "legacy" };\n');
    write(dir, 'app/config/providers.ts', 'export default [];\n');
    write(dir, 'app/src/models/User.ts', 'export default class User {};\n');
    emit(dir, 1);
    expect(existsSync(join(dir, 'dist/config/config.js'))).toBe(true);
    const code = readFileSync(writeDistManifest(dir), 'utf8');
    expect(code).toContain("path: 'app/config/config.ts', load: () => import('./config/config.js')");
    expect(code).toContain("load: () => import('./src/models/User.js')");
    const { default: manifest } = await import(/* @vite-ignore */ pathToFileURL(join(dir, 'dist', MANIFEST_FILE)).href) as { default: AppManifest };
    expect((await manifest.configs[0].load()).default).toEqual({ name: 'legacy' });
  });

  it('fails, naming the include it needs, when tsc emitted no file for a source', () => {
    const dir = join(tmp, 'missing');
    write(dir, 'app/config/config.ts');
    write(dir, 'database/seeders/DatabaseSeeder.ts');
    write(dir, 'dist/app/config/config.js');
    expect(() => writeDistManifest(dir)).toThrow(
      'sauf build: tsc emitted no file for database/seeders/DatabaseSeeder.ts (looked for dist/database/seeders/DatabaseSeeder.js; tsconfig.build.json must include "database/**/*"). An app that imports $api also needs "rootDir": "." in tsconfig.build.json',
    );
    expect(existsSync(join(dir, 'dist', MANIFEST_FILE))).toBe(false);
  });
});

describe('getAppPath (deprecated) in production', () => {
  const previous = { prod: globalThis.__APP_PROD__, cwd: process.cwd() };
  afterEach(() => {
    globalThis.__APP_PROD__ = previous.prod;
    process.chdir(previous.cwd);
  });

  it('follows the same rule as the manifest: dist/app/x.js, else dist/x.js', () => {
    globalThis.__APP_PROD__ = true;
    process.chdir(join(tmp, 'legacy'));
    expect(getAppPath('/config/config.ts', false)).toBe(join(tmp, 'legacy', 'dist', 'config', 'config.js'));
    process.chdir(join(tmp, 'dist'));
    expect(getAppPath('/config/config.ts', false)).toBe(join(tmp, 'dist', 'dist', 'app', 'config', 'config.js'));
  });
});

describe('db:seed', () => {
  const seed = (options: { class?: string }) => {
    const command = new SeedDatabaseCommand();
    command.opts = () => options;
    return command;
  };

  beforeAll(async () => {
    const { default: manifest } = await import(/* @vite-ignore */ pathToFileURL(join(tmp, 'dist', 'dist', MANIFEST_FILE)).href) as { default: AppManifest };
    setAppManifest(manifest);
  });

  it('--class takes a seeder in a sub-folder by its path', async () => {
    const [Seeder] = (await seed({ class: 'Admin/UserSeeder' }).getSeeders())!;
    expect(new Seeder!()).toMatchObject({ layout: '0.5 nested' });
    const [Default] = (await seed({}).getSeeders())!;
    expect(new Default!()).toMatchObject({ layout: '0.5' });
  });

  it('an unknown seeder is an error and exits non-zero, before the wait for the connection', async () => {
    const error = vi.spyOn(Console, 'error').mockImplementation(() => {});
    const exitCode = process.exitCode;
    try {
      const started = performance.now();
      expect(await seed({ class: 'Nope' }).handle()).toBe(1);
      expect(process.exitCode).toBe(1);
      expect(performance.now() - started).toBeLessThan(1000);
      expect(error).toHaveBeenCalledWith('Seeder class Nope not found in the seeders folder (app/database/seeders or database/seeders)');
    } finally {
      process.exitCode = exitCode;
      error.mockRestore();
    }
  });
});

describe('appManifest', () => {
  it('throws a clear error before an entry set one', () => {
    const store = globalThis as { __laratype_manifest?: AppManifest };
    const saved = store.__laratype_manifest;
    delete store.__laratype_manifest;
    try {
      expect(() => appManifest()).toThrow(/No app manifest: start the app with `sauf dev`/);
    } finally {
      if (saved) setAppManifest(saved);
    }
  });
});
