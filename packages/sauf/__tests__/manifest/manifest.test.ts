import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Console } from '@laratype/console';
import { appManifest, emittedPaths, findEmitted, getAppPath, manifestEntry, setAppManifest, type AppManifest } from '@laratype/support';
import {
  emitManifest, emitManifestError, inManifestDirs, isManifestFile, laratypeManifest, MANIFEST_DIRS, MANIFEST_FILE, MANIFEST_ID,
  ManifestScanError, scanManifest, useAppManifest, writeDistManifest, type ScannedManifest,
} from '../../src/manifest';
import { importRootCommands, importRouteConsoleCommands } from '../../src/utils';
import { shouldRestart } from '../../src/utils/restarter';

/**
 * B1 #125: the app manifest (`virtual:laratype/app` in dev, `dist/app.manifest.js` after `sauf build`) replaces the
 * runtime path discovery of providers, configs, routes, commands, models, migrations and seeders.
 * Each suite builds its own fixture folder, so `-t` / `.only` run on their own.
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
  write(dir, 'app/models/concerns/HasSlug.ts');          // a helper: models are read from the top level only
  write(dir, 'app/database/seeders/DatabaseSeeder.ts', 'export default class DatabaseSeeder { layout = "0.5" };\n');
  write(dir, 'app/database/seeders/Admin/UserSeeder.ts', 'export default class UserSeeder { layout = "0.5 nested" };\n');
  write(dir, 'database/seeders/PostSeeder.ts', 'export default class PostSeeder { layout = "v1" };\n');
  write(dir, 'database/migrations/2026_01_02_posts.ts');
  write(dir, 'database/migrations/2026_01_01_users.ts');
  write(dir, 'app/modules/billing/index.ts');
  write(dir, 'app/modules/billing/helpers.ts');          // a module is its index only
  write(dir, 'app/modules/notes/index.mts');
  write(dir, 'app/modules/loose.ts');                    // a module is a folder with an index
  return dir;
};

/** Writes what tsc would emit for every source of `dir`, at `emittedPaths()[layout]` (0: `rootDir: "."`, 1: the 0.5 build). */
const emit = (dir: string, layout: 0 | 1) => {
  const scan = scanManifest(dir);
  for (const entry of [scan.providers!, ...Object.values(scan.kinds).flat()]) {
    const out = emittedPaths(entry.path);
    write(dir, join('dist', out[layout] ?? out[0]!), readFileSync(join(dir, entry.path), 'utf8'));
  }
};

const paths = (scan: ScannedManifest) => Object.fromEntries(Object.entries(scan.kinds).map(([kind, entries]) => [kind, entries.map((e) => e.path)]));

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'laratype-manifest-'));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('scanManifest', () => {
  let dir: string;
  beforeAll(() => {
    dir = project('scan');
  });

  it('finds every kind in both layouts, the 0.5 one first, sorted by name', () => {
    const scan = scanManifest(dir);
    expect(scan.providers).toEqual({ name: 'providers', path: 'app/config/providers.ts' });
    expect(paths(scan)).toEqual({
      configs: ['app/config/auth.ts', 'app/config/config.ts'],
      routes: ['app/routes/api.ts', 'app/routes/console.ts'],
      commands: ['app/src/console/commands/SendMail.ts'],
      models: ['app/src/models/Legacy.js', 'app/src/models/User.ts', 'app/models/Post.ts', 'app/models/Tag.mts'],
      migrations: ['database/migrations/2026_01_01_users.ts', 'database/migrations/2026_01_02_posts.ts'],
      seeders: ['app/database/seeders/Admin/UserSeeder.ts', 'app/database/seeders/DatabaseSeeder.ts', 'database/seeders/PostSeeder.ts'],
      factories: [],
      modules: ['app/modules/billing/index.ts', 'app/modules/notes/index.mts'],
    });
    expect(scan.kinds.models.map((e) => e.name)).toEqual(['Legacy', 'User', 'Post', 'Tag']);
    expect(scan.kinds.modules.map((e) => e.name)).toEqual(['billing', 'notes']);
  });

  it('names seeders by their path in the seeders folder, as db:seed --class takes them', () => {
    expect(scanManifest(dir).kinds.seeders.map((e) => e.name)).toEqual(['Admin/UserSeeder', 'DatabaseSeeder', 'PostSeeder']);
  });

  it('the provider list may be providers.js (or .mts, .mjs), and is never a config', () => {
    const js = join(tmp, 'providers-js');
    write(js, 'app/config/config.ts');
    write(js, 'app/config/providers.js', 'export default [];\n');
    const scan = scanManifest(js);
    expect(scan.providers).toEqual({ name: 'providers', path: 'app/config/providers.js' });
    expect(scan.kinds.configs.map((e) => e.name)).toEqual(['config']);
  });

  it('a name twice in one kind is a scan error: both layouts, providers.ts next to providers.js, two module indexes', () => {
    const models = join(tmp, 'duplicate-models');
    write(models, 'app/src/models/User.ts');
    write(models, 'app/models/User.ts');
    expect(() => scanManifest(models)).toThrow(ManifestScanError);
    expect(() => scanManifest(models)).toThrow('models/User is in both app/src/models/User.ts and app/models/User.ts: rename or remove one');

    const providers = join(tmp, 'duplicate-providers');
    write(providers, 'app/config/providers.js');
    write(providers, 'app/config/providers.ts');
    expect(() => scanManifest(providers)).toThrow('configs/providers is in both app/config/providers.js and app/config/providers.ts');

    const modules = join(tmp, 'duplicate-modules');
    write(modules, 'app/modules/billing/index.js');
    write(modules, 'app/modules/billing/index.ts');
    expect(() => scanManifest(modules)).toThrow('modules/billing is in both app/modules/billing/index.js and app/modules/billing/index.ts');
  });

  it('skips folders that do not exist, and has no providers entry without app/config/providers.*', () => {
    const empty = join(tmp, 'empty');
    mkdirSync(empty, { recursive: true });
    const scan = scanManifest(empty);
    expect(scan.providers).toBeUndefined();
    expect(Object.values(scan.kinds).every((entries) => entries.length === 0)).toBe(true);
  });

  it('inManifestDirs / isManifestFile: exactly the files the scan reads', () => {
    expect(inManifestDirs('app/src/models/Tag.ts')).toBe(true);
    expect(inManifestDirs('database\\seeders\\X.ts')).toBe(true);
    expect(inManifestDirs('database/seeders/Admin/X.ts')).toBe(true);           // seeders: any depth
    expect(inManifestDirs('app/models/concerns/HasSlug.ts')).toBe(false);       // models: top level only
    expect(inManifestDirs('app/modules/billing/index.mts')).toBe(true);
    expect(inManifestDirs('app/modules/billing/helpers.ts')).toBe(false);
    expect(inManifestDirs('app/modules/loose.ts')).toBe(false);
    expect(inManifestDirs('app/config/providers.js')).toBe(true);
    expect(inManifestDirs('app/src/http/controllers/X.ts')).toBe(false);
    expect(isManifestFile('/p', '/p/app/models/X.mjs')).toBe(true);
    expect(isManifestFile('/p', '/p/app/models/X.ts~')).toBe(false);
    expect(isManifestFile('/p', '/p/app/models/X.d.ts')).toBe(false);
    expect(isManifestFile('/p', '/other/app/models/X.ts')).toBe(false);
    expect(Object.keys(MANIFEST_DIRS)).toEqual(['configs', 'routes', 'commands', 'models', 'migrations', 'seeders', 'factories', 'modules']);
  });
});

describe('emitManifest', () => {
  const kinds = Object.fromEntries(Object.keys(MANIFEST_DIRS).map((kind) => [kind, []])) as unknown as ScannedManifest['kinds'];

  it('writes one lazy loader with a literal specifier per entry', () => {
    const code = emitManifest(
      { providers: { name: 'providers', path: 'app/config/providers.ts' }, kinds: { ...kinds, models: [{ name: "O'Neil", path: "app/models/O'Neil.ts" }] } },
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

  it('emitManifestError: empty lists and the error', () => {
    expect(emitManifestError("models/User is in both 'a' and 'b'")).toContain("  error: 'models/User is in both \\'a\\' and \\'b\\'',\n");
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

    // Elsewhere, or a helper in a sub-folder: the cached module stays
    const cached = (await server.ssrLoadModule(MANIFEST_ID)).default;
    server.watcher.emit('add', join(dir, 'app/src/http/X.ts'));
    server.watcher.emit('add', join(dir, 'app/models/concerns/HasSlug.ts'));
    expect((await server.ssrLoadModule(MANIFEST_ID)).default).toBe(cached);
  });

  it('a scan error is served as the manifest error: warned once, thrown by appManifest(), no project commands', async () => {
    const broken = join(tmp, 'dev-broken');
    write(broken, 'app/src/models/User.ts');
    write(broken, 'app/models/User.ts');
    write(broken, 'app/src/console/commands/SendMail.ts', 'export default class SendMail {};\n');
    const brokenServer = await createServer({
      root: broken, configFile: false, logLevel: 'silent',
      server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
      plugins: [laratypeManifest({ projectDir: broken })],
    });
    const warn = vi.spyOn(Console, 'warn').mockImplementation(() => {});
    try {
      const message = '[laratype:manifest] models/User is in both app/src/models/User.ts and app/models/User.ts: rename or remove one';
      const manifest = await useAppManifest((id) => brokenServer.ssrLoadModule(id));
      await useAppManifest((id) => brokenServer.ssrLoadModule(id));
      expect(manifest.error).toBe(message);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(message);
      expect(() => appManifest()).toThrow(message);
      expect(() => manifestEntry('configs', 'config')).toThrow(message);
      expect(await importRootCommands(manifest)).toEqual([]);
      expect(await importRouteConsoleCommands(manifest)).toEqual([]);
    } finally {
      warn.mockRestore();
      await brokenServer.close();
    }
  });
});

describe('shouldRestart (sauf dev --hmr)', () => {
  const inManifest = (file: string) => isManifestFile('/p', file);

  it('restarts when a file is added to or deleted from a manifest folder, so the app boots with the new list', () => {
    expect(shouldRestart('add', '/p/app/src/models/Tag.ts', undefined, inManifest)).toBe(true);
    expect(shouldRestart('unlink', '/p/database/seeders/X.ts', undefined, inManifest)).toBe(true);
    expect(shouldRestart('add', '/p/app/models/concerns/HasSlug.ts', undefined, inManifest)).toBe(false);
    expect(shouldRestart('add', '/p/app/src/http/X.ts', undefined, inManifest)).toBe(false);
    expect(shouldRestart('add', '/p/app/src/models/Tag.ts', undefined)).toBe(false);
  });
});

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
    const dir = join(tmp, 'legacy-build');
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

  it('fails on a stale dist that holds both layouts\' files', () => {
    const dir = join(tmp, 'stale');
    write(dir, 'app/config/config.ts');
    write(dir, 'dist/app/config/config.js');
    write(dir, 'dist/config/config.js');
    expect(() => writeDistManifest(dir)).toThrow('stale dist: both dist/app/config/config.js and dist/config/config.js exist, clean dist/ and build again');
    expect(() => findEmitted(join(dir, 'dist'), 'app/config/config.ts')).toThrow(/^stale dist/);
  });
});

describe('getAppPath (deprecated) in production', () => {
  const previous = { prod: globalThis.__APP_PROD__, cwd: process.cwd() };
  let root: string;

  beforeAll(() => {
    root = join(tmp, 'app-path');
    write(root, 'legacy/dist/config/config.js');
    write(root, 'tree/dist/app/config/config.js');
    write(root, 'stale/dist/config/config.js');
    write(root, 'stale/dist/app/config/config.js');
  });

  afterEach(() => {
    globalThis.__APP_PROD__ = previous.prod;
    process.chdir(previous.cwd);
  });

  it('follows the same rule as the manifest: dist/app/x.js, else dist/x.js, and fails on a stale dist', () => {
    globalThis.__APP_PROD__ = true;
    process.chdir(join(root, 'legacy'));
    expect(getAppPath('/config/config.ts', false)).toBe(join(root, 'legacy', 'dist', 'config', 'config.js'));
    process.chdir(join(root, 'tree'));
    expect(getAppPath('/config/config.ts', false)).toBe(join(root, 'tree', 'dist', 'app', 'config', 'config.js'));
    process.chdir(join(root, 'stale'));
    expect(() => getAppPath('/config/config.ts', false)).toThrow(/^stale dist: both dist\/app\/config\/config\.js and dist\/config\/config\.js exist/);
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
