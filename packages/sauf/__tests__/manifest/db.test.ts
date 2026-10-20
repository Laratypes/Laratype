import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Console } from '@laratype/console';
import { setAppManifest, type AppManifest, type ManifestEntry } from '@laratype/support';
import SeedDatabaseCommand from '../../src/commands/db/seed';
import InitDatabaseCommand from '../../src/commands/db/init';
import { DATABASE_MISSING } from '../../src/commands/db/database';

/** `db:*` with the app manifest (B1 #125): seeders by their path in the seeders folder, and the missing-package hint. */

// importModule() logs a failed import and returns undefined: stand in for a project without @laratype/database
const importModule = vi.hoisted(() => vi.fn());
vi.mock('@laratype/support', async (original) => ({ ...(await original<typeof import('@laratype/support')>()), importModule }));

let tmp: string;

/** A manifest of seeder files: `DatabaseSeeder` and the sub-folder one `Admin/UserSeeder`. */
const seeders = (dir: string): ManifestEntry[] =>
  ['DatabaseSeeder', 'Admin/UserSeeder'].map((name) => {
    const file = join(dir, 'app/database/seeders', `${name}.js`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `export default class ${posix.basename(name)} { name = ${JSON.stringify(name)} };\n`);
    return { name, path: `app/database/seeders/${name}.ts`, load: () => import(/* @vite-ignore */ pathToFileURL(file).href) };
  });

const seed = (options: { class?: string }) => {
  const command = new SeedDatabaseCommand();
  command.opts = () => options;
  return command;
};

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'laratype-db-'));
  const empty: ManifestEntry[] = [];
  setAppManifest({ configs: empty, routes: empty, commands: empty, models: empty, migrations: empty, seeders: seeders(tmp), factories: empty, modules: empty } satisfies AppManifest);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('db:seed', () => {
  it('--class takes a seeder in a sub-folder by its path; DatabaseSeeder without it', async () => {
    const [Seeder] = (await seed({ class: 'Admin/UserSeeder' }).getSeeders())!;
    expect(new Seeder!()).toMatchObject({ name: 'Admin/UserSeeder' });
    const [Default] = (await seed({}).getSeeders())!;
    expect(new Default!()).toMatchObject({ name: 'DatabaseSeeder' });
  });

  it('--class takes a Windows path and a file name with its extension, as before the manifest', async () => {
    for (const name of ['Admin\\UserSeeder', 'Admin/UserSeeder.ts', 'Admin\\UserSeeder.mts']) {
      const [Seeder] = (await seed({ class: name }).getSeeders())!;
      expect(new Seeder!()).toMatchObject({ name: 'Admin/UserSeeder' });
    }
    const [Default] = (await seed({ class: 'DatabaseSeeder.ts' }).getSeeders())!;
    expect(new Default!()).toMatchObject({ name: 'DatabaseSeeder' });
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

describe('db:* without @laratype/database', () => {
  it('gives the install hint, not a TypeError, when importModule() returns undefined or throws', async () => {
    importModule.mockResolvedValueOnce(undefined);
    await expect(seed({}).providers([])).rejects.toThrow(DATABASE_MISSING);
    importModule.mockRejectedValueOnce(new Error('Cannot find package'));
    await expect(new InitDatabaseCommand().providers([])).rejects.toThrow(DATABASE_MISSING);
    expect(DATABASE_MISSING).toMatch(/^Database package is not installed/);
  });
});
