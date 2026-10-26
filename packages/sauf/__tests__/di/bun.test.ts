import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DI_PLUGIN_NAME, DI_RUNTIME_ID, laratypeDiBun, type DiBunPlugin, type DiBunPluginBuilder } from '../../src/di';

/**
 * T4 #116: `laratype:di` as a Bun plugin, enabled in `bun.build.js`, so framework classes resolved by the
 * container work from `dist/`.
 */
const appDir = fileURLToPath(new URL('./plugin-app', import.meta.url));
const mainFile = join(appDir, 'main.ts');
const greetingFile = join(appDir, 'greeting.ts');
const httpDir = fileURLToPath(new URL('../../../http', import.meta.url));

type OnLoad = Parameters<DiBunPluginBuilder['onLoad']>[1];

const setup = (plugin: DiBunPlugin) => {
  let filter: RegExp | undefined;
  let onLoad: OnLoad | undefined;
  plugin.setup({
    onLoad(options, callback) {
      filter = options.filter;
      onLoad = callback;
    },
  });
  return { filter: filter!, onLoad: onLoad! };
};

describe('laratype:di Bun plugin hooks', () => {
  const { filter, onLoad } = setup(laratypeDiBun());

  it('has the plugin name', () => {
    expect(laratypeDiBun().name).toBe(DI_PLUGIN_NAME);
  });

  it.each(['main.ts', 'main.tsx', 'main.mts', 'main.cts'])('loads %s', (file) => {
    expect(filter.test(join(appDir, file))).toBe(true);
  });

  it.each(['main.js', 'main.json'])('does not load %s', (file) => {
    expect(filter.test(join(appDir, file))).toBe(false);
  });

  it('transforms the file, with the helper imported from @laratype/core', async () => {
    const result = await onLoad({ path: mainFile });
    expect(result?.loader).toBe('ts');
    expect(result?.contents).toContain(`import { __laratype_deps } from ${JSON.stringify(DI_RUNTIME_ID)};`);
    expect(result?.contents).toContain('__laratype_deps(GreetingController, [() => GreetingService], { params: ["greeting"] });');
  });

  it('returns the source unchanged when there is nothing to emit', async () => {
    expect(await onLoad({ path: greetingFile })).toEqual({ contents: readFileSync(greetingFile, 'utf8'), loader: 'ts' });
  });

  it('passes the transform options through', async () => {
    const { onLoad } = setup(laratypeDiBun({ helperId: 'virtual:custom' }));
    expect((await onLoad({ path: mainFile }))?.contents).toContain('from "virtual:custom";');
  });

  it('keeps the @laratype/core default for an undefined helperId', async () => {
    const { onLoad } = setup(laratypeDiBun({ helperId: undefined }));
    expect((await onLoad({ path: mainFile }))?.contents).toContain(`from ${JSON.stringify(DI_RUNTIME_ID)};`);
  });

  it.each([
    ['node_modules', join(appDir, 'node_modules/pkg/index.ts')],
    ['declaration files', join(appDir, 'main.d.ts')],
  ])('skips %s', async (_, path) => {
    expect(await onLoad({ path })).toBeUndefined();
  });

  it('skips files `include` rejects, with the path normalized to forward slashes', async () => {
    const seen: string[] = [];
    const { onLoad } = setup(laratypeDiBun({ include: (file) => (seen.push(file), false) }));
    expect(await onLoad({ path: mainFile })).toBeUndefined();
    expect(seen).toEqual([mainFile.replace(/\\/g, '/')]);
  });
});

/** Runs `code` in a plain Node process from `packages/http`, which resolves `@laratype/*` to the built `dist/`. */
const runNode = (args: string[], code: string) =>
  execFileSync('node', [...args, '-e', code], { cwd: httpDir, encoding: 'utf8' }).trim();

// `bun run build` first (CI does). `Request` (@laratype/http) takes `HonoRequest` in its constructor: without the
// metadata the Bun plugin emits, `make(Request)` throws `Cannot autowire Request`.
const resolveRequest = (load: string) => `
  ${load}
  const container = new Container({ deps: depsRegistry });
  container.instance(HonoRequest, new HonoRequest(new globalThis.Request("http://laratype.test/users?page=2")));
  const request = container.make(Request);
  console.log(JSON.stringify({
    instance: request instanceof Request,
    page: request.query("page"),
    ownDeps: hasOwnDeps(Request),
    params: getDeps(Request).entry.meta.params,
    from: SOURCE,
  }));
`;

// A cold `node` start takes seconds on Windows, and these two spawn one each: more than the 5s default.
describe('framework classes resolved by the container from dist/', () => {
  it.each([
    ['ESM', ['--input-type=module'], `
      import { Container, depsRegistry, getDeps, hasOwnDeps } from "@laratype/core";
      import { Request } from "@laratype/http";
      import { HonoRequest } from "hono/request";
      const SOURCE = import.meta.resolve("@laratype/http");
    `],
    ['CJS', [], `
      const { Container, depsRegistry, getDeps, hasOwnDeps } = require("@laratype/core");
      const { Request } = require("@laratype/http");
      const { HonoRequest } = require("hono/request");
      const SOURCE = require.resolve("@laratype/http");
    `],
  ])('%s: autowires @laratype/http Request with its HonoRequest dep', (_, args, load) => {
    const result = JSON.parse(runNode(args, resolveRequest(load)));
    expect(result).toMatchObject({ instance: true, page: '2', ownDeps: true, params: ['requestCtx'] });
    expect(result.from.replace(/\\/g, '/')).toMatch(/\/packages\/http\/dist\/index\.(esm\.js|cjs)$/);
  }, 30_000);
});

// A framework base class carries its own entry in `dist/` too: `@laratype/http`'s `Controller` is registered with `[]`.
// An app subclass with its own constructor and no metadata (`sauf build` runs no transform yet, B2 #126) must fail
// closed rather than be built with the base class's arguments.
const refuseUnregisteredSubclass = (load: string) => `
  ${load}
  class UserController extends Controller {
    constructor(users) {
      super();
      this.users = users;
    }
  }
  const container = new Container({ deps: depsRegistry });
  try {
    container.make(UserController);
    console.log(JSON.stringify({ threw: false }));
  } catch (error) {
    console.log(JSON.stringify({ threw: true, name: error.name, message: error.message.split(" Fix:")[0] }));
  }
`;

describe('an untransformed subclass fails closed from dist/', () => {
  it.each([
    ['ESM', ['--input-type=module'], `
      import { Container, depsRegistry } from "@laratype/core";
      import { Controller } from "@laratype/http";
    `],
    ['CJS', [], `
      const { Container, depsRegistry } = require("@laratype/core");
      const { Controller } = require("@laratype/http");
    `],
  ])('%s: refuses to autowire a subclass of @laratype/http Controller with no metadata', (_, args, load) => {
    const result = JSON.parse(runNode(args, refuseUnregisteredSubclass(load)));
    expect(result).toEqual({
      threw: true,
      name: 'DiError',
      message: 'Cannot autowire UserController: its constructor takes 1 param(s) but no dependency metadata was found.',
    });
  }, 30_000);
});

// `bun.build.js` enables the plugin for every package that lists `@laratype/core` in `dependencies`, on its own
// `src/` only: `http`, `support`, `auth`, `log` and `laratype`. The minified dists keep the helper name: an import
// in ESM, a member call on the `require` in CJS. `laratype` is enabled too, but its sources have no own
// constructor yet, so its dist carries no call to assert.
const packagesDir = fileURLToPath(new URL('../../../', import.meta.url));
const dist = (pkg: string, file: string) => readFileSync(join(packagesDir, pkg, 'dist', file), 'utf8');
const esmHelperImport = /import\s*\{\s*__laratype_deps\b/;
const cjsHelperCall = /\.__laratype_deps\(/;

const distCases: Array<[pkg: string, file: string, metadata: RegExp]> = [
  ['http', 'esm.js', esmHelperImport],
  ['http', 'cjs', cjsHelperCall],
  ['support', 'esm.js', esmHelperImport],
  ['support', 'cjs', cjsHelperCall],
  ['auth', 'esm.js', esmHelperImport],
  ['auth', 'cjs', cjsHelperCall],
  ['log', 'esm.js', esmHelperImport],
  ['log', 'cjs', cjsHelperCall],
];

describe('bun.build.js enables the plugin per package', () => {
  it.each(distCases)('%s dist/index.%s carries the emitted metadata', (pkg, file, metadata) => {
    expect(dist(pkg, `index.${file}`)).toMatch(metadata);
  });

  it('skips @laratype/core, which defines the helper', () => {
    expect(dist('core', 'index.esm.js')).not.toMatch(esmHelperImport);
    expect(dist('core', 'index.cjs')).not.toMatch(cjsHelperCall);
  });
});
