import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Console } from '@laratype/console';
import { appManifest, manifestEntry, setAppManifest, type AppManifest } from '@laratype/support';
import {
  emitManifest, emitManifestError, inManifestDirs, isManifestFile, laratypeManifest, MANIFEST_DIRS, MANIFEST_ID,
  ManifestScanError, scanManifest, useAppManifest, type ScannedManifest,
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
  write(dir, 'app/src/console/commands/helper.js');      // commands are .ts / .mts: a stray .js is not loaded
  write(dir, 'app/config/legacy.js');                    // so are configs
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

  it('each kind reads its own extensions: a stray .js among the commands or configs is ignored, models take any', () => {
    expect(inManifestDirs('app/src/console/commands/helper.js')).toBe(false);
    expect(inManifestDirs('app/src/console/commands/Mail.mts')).toBe(true);
    expect(inManifestDirs('app/config/legacy.js')).toBe(false);
    expect(inManifestDirs('app/src/models/Legacy.mjs')).toBe(true);
    expect(inManifestDirs('database/seeders/X.js')).toBe(false);
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

  it('a name twice in one kind is a scan error: both layouts, providers.ts next to providers.mjs, two module indexes', () => {
    const models = join(tmp, 'duplicate-models');
    write(models, 'app/src/models/User.ts');
    write(models, 'app/models/User.ts');
    expect(() => scanManifest(models)).toThrow(ManifestScanError);
    expect(() => scanManifest(models)).toThrow('models/User is in both app/src/models/User.ts and app/models/User.ts: rename or remove one');

    const providers = join(tmp, 'duplicate-providers');
    write(providers, 'app/config/providers.mjs');
    write(providers, 'app/config/providers.ts');
    expect(() => scanManifest(providers)).toThrow('configs/providers is in both app/config/providers.mjs and app/config/providers.ts');

    const modules = join(tmp, 'duplicate-modules');
    write(modules, 'app/modules/billing/index.mjs');
    write(modules, 'app/modules/billing/index.ts');
    expect(() => scanManifest(modules)).toThrow('modules/billing is in both app/modules/billing/index.mjs and app/modules/billing/index.ts');
  });

  it('a .js next to its .ts (.mjs next to .mts) is tsc output of a build without outDir: skipped, not a duplicate', () => {
    const dir = join(tmp, 'emitted-next-to');
    for (const file of ['app/config/providers', 'app/src/models/User', 'app/modules/billing/index']) {
      write(dir, `${file}.ts`);
      write(dir, `${file}.js`);
    }
    write(dir, 'app/src/models/Post.mts');
    write(dir, 'app/src/models/Post.mjs');
    write(dir, 'app/src/models/Legacy.js');                                  // no source next to it: still a model
    const scan = scanManifest(dir);
    expect(scan.providers).toEqual({ name: 'providers', path: 'app/config/providers.ts' });
    expect(scan.kinds.models).toEqual([
      { name: 'Legacy', path: 'app/src/models/Legacy.js' },
      { name: 'Post', path: 'app/src/models/Post.mts' },
      { name: 'User', path: 'app/src/models/User.ts' },
    ]);
    expect(scan.kinds.modules).toEqual([{ name: 'billing', path: 'app/modules/billing/index.ts' }]);
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

describe('symlinks', () => {
  // A folder junction needs no admin rights on Windows; a file symlink may: skipped when it can't be made
  const link = (target: string, path: string, type: 'file' | 'junction') => {
    try {
      symlinkSync(target, path, type);
      return true;
    } catch {
      return false;
    }
  };

  it('follows links inside the project, not loops or links outside it, with one warning', (ctx) => {
    const dir = join(tmp, 'links');
    const outside = join(tmp, 'outside');
    write(dir, 'app/src/models/User.ts');
    write(dir, 'shared/models/Tag.ts');
    write(dir, 'shared/seeders/SharedSeeder.ts');
    write(dir, 'app/database/seeders/DatabaseSeeder.ts');
    write(outside, 'EvilSeeder.ts');
    write(outside, 'Evil.ts');
    if (!link(join(dir, 'shared/seeders'), join(dir, 'app/database/seeders/Shared'), 'junction')) return ctx.skip();
    link(join(dir, 'app/database/seeders'), join(dir, 'app/database/seeders/Loop'), 'junction');
    link(outside, join(dir, 'app/database/seeders/Outside'), 'junction');
    const fileLinks = link(join(dir, 'shared/models/Tag.ts'), join(dir, 'app/src/models/Tag.ts'), 'file')
      && link(join(outside, 'Evil.ts'), join(dir, 'app/src/models/Evil.ts'), 'file');

    const warn = vi.spyOn(Console, 'warn').mockImplementation(() => {});
    try {
      const scan = scanManifest(dir);
      expect(scan.kinds.seeders.map((e) => e.name)).toEqual(['DatabaseSeeder', 'Shared/SharedSeeder']);
      expect(scan.kinds.models.map((e) => e.name)).toEqual(fileLinks ? ['Tag', 'User'] : ['User']);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0]![0] as string;
      expect(message).toMatch(/^\[laratype:manifest\] symlinks not followed: /);
      expect(message).toContain('app/database/seeders/Loop (a symlink loop)');
      expect(message).toContain('app/database/seeders/Outside (links outside the project)');
      if (fileLinks) expect(message).toContain('app/src/models/Evil.ts (links outside the project)');
      scanManifest(dir);
      expect(warn).toHaveBeenCalledTimes(1);   // once per process
    } finally {
      warn.mockRestore();
    }
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

  it('escapes every control character and U+2028 / U+2029: the manifest parses and keeps the string', async () => {
    const message = "a\\b'c\nd\re\tf\u0000g h i";
    const code = emitManifestError(message);
    expect(code).toContain("  error: 'a\\\\b\\'c\\nd\\u000de\\u0009f\\u0000g\\u2028h\\u2029i',\n");
    const manifest = (await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(code)}`)).default as AppManifest;
    expect(manifest.error).toBe(message);
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

describe('importRootCommands', () => {
  it('skips a command file whose default export is not a command class, with one warning', async () => {
    class SendMail { static signature = 'send:mail'; }
    const entry = (path: string, mod: Record<string, unknown>) => ({ name: path, path, load: async () => mod });
    const manifest = {
      configs: [], routes: [], migrations: [], seeders: [], factories: [], modules: [], models: [],
      commands: [entry('app/src/console/commands/SendMail.ts', { default: SendMail }), entry('app/src/console/commands/format.ts', { default: () => '' }), entry('app/src/console/commands/util.ts', {})],
    } satisfies AppManifest;
    const warn = vi.spyOn(Console, 'warn').mockImplementation(() => {});
    try {
      expect(await importRootCommands(manifest)).toEqual([SendMail]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('Skipped app/src/console/commands/format.ts, app/src/console/commands/util.ts: the default export is not a command class (a class with a static signature)');
    } finally {
      warn.mockRestore();
    }
  });

  it('a command file that fails to load is skipped with a warning naming it: the other commands still register', async () => {
    class SendMail { static signature = 'send:mail'; }
    const entry = (path: string, load: () => Promise<Record<string, unknown>>) => ({ name: path, path, load });
    const manifest = {
      configs: [], routes: [], migrations: [], seeders: [], factories: [], modules: [], models: [],
      commands: [
        entry('app/src/console/commands/Broken.ts', () => Promise.reject(new SyntaxError("Unexpected token '}'"))),
        entry('app/src/console/commands/SendMail.ts', async () => ({ default: SendMail })),
        entry('app/src/console/commands/Throws.ts', () => Promise.reject('not an Error')),
      ],
    } satisfies AppManifest;
    const warn = vi.spyOn(Console, 'warn').mockImplementation(() => {});
    try {
      expect(await importRootCommands(manifest)).toEqual([SendMail]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("Skipped app/src/console/commands/Broken.ts (Unexpected token '}'), app/src/console/commands/Throws.ts (not an Error): the command file failed to load");
    } finally {
      warn.mockRestore();
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
