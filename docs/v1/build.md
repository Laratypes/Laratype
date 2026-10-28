---
area: build
packages: ["sauf", "@laratype/testing"]
issues: [102, 116, 125, 126, 127, 128, 129, 130, 131, 132, 155, 156, 172, 173, 185, 187, 188, 189, 190, 191]
verified-against: Laratype@d9e8df2
last-verified: 2026-10-12
---

# Build

v1 has one plugin chain for `sauf dev`, `sauf build` and tests, so DI metadata and decorators behave the same everywhere. Production builds are bundled, verified and type-generated. This file also records the packaging constraints the framework packages must keep.

**State on master (0.5):**
- **Dev** (`sauf dev`) uses Vite SSR with `laratype:di` ([di.md › Vite plugin](./di.md#vite-plugin-laratypedi)) then `RollupPluginSwc` (`packages/sauf/src/bin/warmup.ts`, `utils/plugin.ts`), and an HMR restart (`commands/dev.ts`).
- **Production** builds run `sauf types:generate`, compile with `tsc -b tsconfig.build.json`, then `sauf build` copies the `cli.js` / node adapter entries, runs `tsc-alias` and writes `dist/app.manifest.js` (`commands/build.ts`).
- **Discovery:** the app manifest (`virtual:laratype/app` in dev, `dist/app.manifest.js` in production) lists the app's modules; the framework no longer finds them by file path ([Plugin chain](#plugin-chain), [#125](https://github.com/Laratypes/Laratype/issues/125)).
- **Framework packages** build with `bun.build.js` (ESM + CJS), then `tsc` + `rollup-plugin-dts`. The packages that depend on `@laratype/core` run the DI transform as a Bun plugin ([Bun DI plugin](#bun-di-plugin), proposed).

| Section | Status |
|---|---|
| [Package build fixes (B11–B13)](#package-build-fixes-b11b13) | merged @ 2ad49ad (B13), acf9f2a (B13 CI), e3112eb (B12), f66eafd (B11) |
| [Packaging follow-ups (B16)](#packaging-follow-ups-b16) | merged ([#191](https://github.com/Laratypes/Laratype/issues/191)); `bun run check:pkg` lints every public package |
| [Plugin chain](#plugin-chain) | T2 merged ([#102](https://github.com/Laratypes/Laratype/issues/102)); B1 manifest merged ([#125](https://github.com/Laratypes/Laratype/issues/125)); planned → #126 |
| [sauf build steps](#sauf-build-steps) | planned → #127, #128, #129, #130, #172, #173, #155, #156 |
| [Testing preset](#testing-preset) | planned → #131 |
| [Browser targets and budgets](#browser-targets-and-budgets) | planned → #132 |
| [Bun DI plugin](#bun-di-plugin) | proposed: PR #324 @ 6d0af35 |
| [CI and release](#ci-and-release) | partly merged ([#189](https://github.com/Laratypes/Laratype/issues/189)); planned → #189, #190 |

---

## Package build fixes (B11–B13)

### Status
Merged in this order:
1. merged @ 2ad49ad (B13 [#188](https://github.com/Laratypes/Laratype/issues/188)), and its CI step `bun run check:dist` merged @ acf9f2a;
2. merged @ e3112eb (B12 [#187](https://github.com/Laratypes/Laratype/issues/187));
3. merged @ f66eafd (B11 [#185](https://github.com/Laratypes/Laratype/issues/185)).

### Public API
No public API. These are build configuration and scripts:
- B13 changes `bun.build.js` and `packages/sauf/build.config.js`, and adds `bun run check:dist`.
- B12 adds the regression test `packages/sauf/__tests__/devSsr.test.ts`.
- B11 sets `"verbatimModuleSyntax": true` in `tsconfig.app.json` and `examples/basic/tsconfig.build.json`.

### Invariants
Constraints every package build must keep:
- **No dist inlines another workspace package.** Bun's `external` takes strings and wildcards only; a RegExp is silently ignored. So externals are `"@laratype/*"`, plus every workspace package name, plus each package's own `dependencies` / `peerDependencies` and `buildOptions.external`. Inlined copies gave module singletons (tokens, the container, `ContextApi`) a different identity in each bundle. This is why D4's `HTTP_APP` is temporarily kept on `globalThis` ([di.md](./di.md#serviceprovider-v2-and-kernel-boot)).
- **No `"sideEffects": false` on packages that re-export defaults** (http, database, log). Bun 1.3.14 drops `export { default as X } from './mod'` re-exports under that flag, which left http's `Middleware` `undefined`. That was the root cause of the B12 "superclass is not a constructor" error. `@laratype/contract` and `@laratype/core` keep `sideEffects: false`.
- **CJS output is named `dist/index.cjs`** in `"type": "module"` packages. `main` / `exports.require` point at it. This includes the v1 packages contract, core and client, which S4 added after B13 branched (fixed in ccf9894). This is a breaking change for CJS consumers.
- **`globalThis.__PROD__` is not folded into library dists.** `packages/sauf/src/cli.ts` sets it at runtime, so the dev dist→src rewrite in `sauf dev` stays live.
- **Every dist loads under plain Node**, both ESM `import()` and CJS `require()`, with every export defined. `bun run check:dist` verifies this.
- **Type-only imports use `import type`** (`verbatimModuleSyntax`), as required by S3 condition 1 ([#86](https://github.com/Laratypes/Laratype/issues/86)). B11 brings TS1484/TS1485/TS1205 errors down from 62 to 0, and other pre-existing type errors are unchanged.

### Diagnostics
- `check:dist` fails if a dist inlines another workspace package, or if a dist fails to load under Node.
- `TS1484` / `TS1485` for a type imported as a value.

### Example
None.

### Non-goals
- No change to sauf's SSR logic or `plugin.ts` (B12 needed none).

### Open questions
- CI wiring of `devSsr.test.ts` → [#189](https://github.com/Laratypes/Laratype/issues/189). `check:dist` runs in CI since acf9f2a.
- Removing the `HTTP_APP` `globalThis` workaround after B13 → [#188](https://github.com/Laratypes/Laratype/issues/188) follow-up

### Acceptance
[#188 Done when](https://github.com/Laratypes/Laratype/issues/188) · [#187 Done when](https://github.com/Laratypes/Laratype/issues/187) · [#185 Done when](https://github.com/Laratypes/Laratype/issues/185)

---

## Packaging follow-ups (B16)

### Status
merged ([#191](https://github.com/Laratypes/Laratype/issues/191)); `bun run check:pkg` lints every public package.

### Public API
Package manifests, build configuration and scripts:
- **`exports["."]`** of every public package (auth, client, console, contract, core, database, http, laratype, log, sauf, support, validation) has types for each condition:
  ```json
  ".": {
    "import": { "types": "./dist/index.d.ts", "default": "./dist/index.esm.js" },
    "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
  }
  ```
  `bun run build:type` (`rollup.dts.config.js`) writes `dist/index.d.cts` next to `dist/index.d.ts`.
- **Peer dependencies:**
  - `hono` (`^4.8.0`) for http, support and laratype;
  - `zod` (`^3.25.0`) for http and validation, whose `.d.ts` import zod.
  - Optional workspace peers for imports that are type-only or loaded on demand: support → http; http → auth; laratype → http, auth; sauf → laratype, database.
  - support also has `passport` and `@types/passport` as optional peers (the auth config type).
- **Dependencies** that were devDependencies:
  - support: `dotenv`, `glob`, `mlly`, `ts-toolbelt`;
  - http: `es-toolkit`, and `@hono/node-server` since A5 [#288](https://github.com/Laratypes/Laratype/issues/288) (`getConnInfo` for `Request.ip()` on Node);
  - auth: `jsonwebtoken`, `@types/jsonwebtoken`, `@types/passport`, plus the workspace packages it imports (`@laratype/console`, `@laratype/database`);
  - database: `reflect-metadata`;
  - console: `@laratype/support`;
  - sauf: the CLI's imports (`commander`, `handlebars`, `figlet`, `kolorist`, `@hono/node-server`, the rollup plugins and `rollup`).
- **support** ships `env.d.ts` (`@laratype/support/env`), and its `module` field points at `./dist/index.esm.js`.
- **sauf**'s `bin` dist starts with `#!/usr/bin/env node` (`buildOptions.banner`).
- **broadcast, i18n, mail, schedule, storage and ts-gen** are `private: true` until they have code.
- **`bun run check:pkg`** (`scripts/check-packages.mjs`) runs `publint --strict` and `attw --pack` on every public package. It is not a CI step.

### Invariants
- **Every runtime import of a third-party package is in `dependencies` or `peerDependencies`.** bun.build.js keeps those external. A runtime import declared only in devDependencies is bundled into the dist, which ships a second copy (hono's `HTTPException` / `instanceof`). `check:dist` fails on it.
- **A package that exposes another package's types or instances is a peer of it** (hono, zod, typeorm, dayjs). Packages that are only used internally are `dependencies`.
- **Packages the public `.d.ts` imports are declared too**, as a dependency or a peer (an optional peer when the import is type-only and the edge would be circular). Types-only packages the `.d.ts` needs (`@types/*`, `ts-toolbelt`) are `dependencies`, unless the matching runtime package is an optional peer (support's `@types/passport`).
- **Peer ranges are explicit** (`^4.8.0`), never `catalog:`. The workspace keeps the `catalog:` devDependency for its own install.
- **Each `exports` condition has its own `types`:** `.d.ts` for `import`, `.d.cts` for `require`. In a `"type": "module"` package, one `.d.ts` for both is read as ESM types for the CJS build (attw "Masquerading as ESM").
- **The public `.d.ts` resolve for a consumer** under `moduleResolution: NodeNext`, ESM and CJS, with `skipLibCheck: false`. They do not refer to the repo-only globals in `packages/global.d.ts`. Deep imports use the target's `exports` keys (`typeorm/driver/.../XConnectionOptions.js`).
- **Named imports from CommonJS packages are not used once the package is external** (`import Handlebars from "handlebars"`, not `import { compile }`). Node's ESM loader cannot always detect CJS named exports. `check:dist` loads every ESM chunk to catch this.
- **sauf's resources bundles (`resources/app`) stay self-contained.** `sauf build` copies them into the app's `dist`, where sauf's own dependencies are not resolvable.

### Diagnostics
- `check:dist`: `<metafile>: inlines <pkg> (<n> inputs), declared only in devDependencies`.
- `check:dist`: an ESM chunk that fails to load (`sauf chunk dist/chunk-*.js: SyntaxError: Named export ... not found`).
- `check:pkg`: the publint or attw output of the failing package.

### Non-goals
- No CI step for `check:pkg` (#189/#190 decide CI).
- publint suggestions are not applied: `engines.node` (would be breaking), and `sideEffects: false` for console and support.

### Acceptance
[#191 Done when](https://github.com/Laratypes/Laratype/issues/191)

---

## Plugin chain

### Status
The DI plugin in `sauf dev` (T2) is merged ([#102](https://github.com/Laratypes/Laratype/issues/102)). The app manifest (B1) is merged ([#125](https://github.com/Laratypes/Laratype/issues/125)). The shared chain is planned → [#126](https://github.com/Laratypes/Laratype/issues/126) (B2). The DI transform core itself is merged @ 8dc389b ([di.md › DI transform](./di.md#di-transform)).

### Design (non-binding)
```
laratype:manifest  →  laratype:di  →  swc (decorators for the ORM)  →  alias (tsconfig paths)
```
- **`laratype:manifest` (B1, merged [#125](https://github.com/Laratypes/Laratype/issues/125)):** the app manifest, which replaces runtime path discovery (path discovery prevents bundling). [`packages/sauf/src/manifest/`](../../packages/sauf/src/manifest/) · [`packages/support/src/manifest/AppManifest.ts`](../../packages/support/src/manifest/AppManifest.ts)
  - **Shape:** `{ providers, configs, routes, commands, models, migrations, seeders, factories, modules }`. `providers` is the entry of `app/config/providers.ts` (or `.mts`, `.js`, `.mjs`; never a config): the explicit list of providers the app boots, in its order. Provider classes in `app/providers/` (or `app/src/providers/`) are **not** registered on their own; the list names them. Every other kind is a list of `ManifestEntry { name, path, load }`, where `name` is the file name without its extension (the folder name for a module, the path in the folder for a seeder) and `path` the source file relative to the project.
  - **Lazy loaders with static specifiers:** each `load` is `() => import('<literal>')`. A bundler still sees every module, and the CLI imports only what a command needs: `sauf --help` or `make:*` loads no route, model or `$api`, and `db:seed --class X` loads one seeder.
  - **Discovery** (`MANIFEST_DIRS`, the one table of folders): `app/config` (configs), `app/routes` (routes: `api`, `console`, `channels`), `app/src/console/commands` and `app/console/commands`, `app/src/models` and `app/models`, `app/database/{migrations,seeders,factories}` and `database/{migrations,seeders,factories}`, and `app/modules/<name>/index.ts` (or `index.mts`, `.js`, `.mjs`; modules, read by K2 [#153](https://github.com/Laratypes/Laratype/issues/153); nothing boots them yet). The 0.5 folders come first, then the v1 layout of [overview.md › Project structure](./overview.md#project-structure). Each kind reads what the runtime discovery before the manifest loaded (`KIND_EXTENSIONS`): models any of `*.ts`, `*.mts`, `*.js`, `*.mjs` (the old `src/models/*` glob), the provider list and module indexes too, and the other kinds `*.ts` and `*.mts`, so a stray `helper.js` among the commands is not loaded. A `*.d.ts`, `*.test.*` or `*.spec.*` file is never read. Symlinks are followed, as the old glob did, but not to a target outside the project or back to a folder being read (a loop): those are skipped, and one warning lists them (`[laratype:manifest] symlinks not followed: <path> (links outside the project), <path> (a symlink loop)`). Seeders are read with their sub-folders and named by their path there (`Admin/UserSeeder`, as `db:seed --class` takes it); the other kinds read the folder's top level only. A folder that does not exist is skipped, and a kind found in both layouts is loaded from both. One name twice in a kind (`app/src/models/User.ts` and `app/models/User.ts`, `User.ts` next to `User.mjs`, `providers.ts` next to `providers.mjs`, or two `index.*` in a module) is a scan error: `models/User is in both app/src/models/User.ts and app/models/User.ts: rename or remove one`. A `.js` next to the `.ts` of the same name (`.mjs` next to `.mts`) is what tsc writes without `outDir`: it is not read, so it is no duplicate. In dev the manifest then carries the error (`AppManifest.error`, prefixed `[laratype:manifest] `). Every `sauf` command prints it once as a warning, and `appManifest()` throws it, so only what needs the app fails: `sauf dev`, `build`, `route:list`, `db:*` and every command that boots the app. `--help`, `types:generate` and `make:*` (`static bootsApp = false`) run. `sauf build` fails on it too. Moving `examples/basic` to the v1 layout, then removing the 0.5 folders, is E3 [#135](https://github.com/Laratypes/Laratype/issues/135).
  - **Dev:** the `laratype:manifest` Vite plugin (first in the `warmup.ts` plugin list) serves `virtual:laratype/app`, reading the folders on each load. Its loaders import the source files, so Vite transforms them like any module. Under `sauf dev --hmr`, adding or deleting a file the scan reads (`isManifestFile()`: a module file at the depth its kind is read, so not a helper in `app/models/concerns/`) invalidates the module and restarts the server, which boots with the new list. The CLI loads the app's commands through Vite with `fixStacktrace`.
  - **Production:** `sauf build` writes `dist/app.manifest.js` (next to `dist/index.js` and `dist/cli.js`) before it copies them, and removes an old one first, so a failed step never leaves new bundles next to an old manifest. It loads `typescript` (an optional peer of sauf) only there: `sauf build needs typescript (install it as a devDependency)` when it is missing. It parses `tsconfig.build.json` once; a config error, an `include` that matches nothing (`sauf build: tsconfig.build.json: No inputs were found in config file ...`) or a program of declaration files only (`sauf build: tsconfig.build.json has no source file to build (its "include": [...])`) fails the build, where it would have shipped an empty manifest. `getOutputFileNames` then says where tsc emitted each source, so any `outDir` / `rootDir` works: the 0.5 build (`include: ["app/**/*"]`, no `rootDir`: `dist/config/config.js` on TypeScript 5), `"rootDir": "."` (`dist/app/config/config.js`), or another `outDir` (`../build/app/config/config.js`). A 0.5 app keeps its `tsconfig.build.json`. Only an app that imports `$api` needs `"rootDir": "."`, so that `dist/.laratype/api/index.gen.js` finds `../../app/api/*`. A source that is not in the build program (excluded, or the v1 layout's root `database/` without `"database/**/*"` in `include`) is left out of the manifest, with one warning: `Not in the program of tsconfig.build.json, so left out of dist/app.manifest.js: <files> (add their folder to "include" to ship them)`. A source in the program whose output is missing fails the build: `sauf build: tsc emitted no file for <source> (<output>): run tsc -b tsconfig.build.json first (its "include": [...])`. Without `outDir`, the output is the `.js` next to each source (the `tsc-alias` step after it still needs `outDir`). The manifest records `appDir`, where tsc emits `app/` relative to it (`""`, `"app"`, `"../build/app"`, `"../app"` without `outDir`): `outDir` plus the path of `app/` from the root tsc mirrors there, so it holds even when no `app/` file is in the program. That root is `rootDir`, or the config's folder for a composite project or from TypeScript 6 (its default without `rootDir`: the 0.5 build then emits `dist/app/config/config.js`, `appDir` `"app"`, and tsc reports TS5011 until `rootDir` is set). Otherwise (TypeScript 5), tsc takes the common folder of every source of the program, the files imported from outside `include` too (`$api` from `.laratype/` without `"rootDir": "."`), which the config does not list: `sauf build` builds the program (parsed, without the default lib and `@types`, not type-checked) to list them, as tsc does. `dist/index.js` and `dist/cli.js` without the manifest fail with ``dist/app.manifest.js not found: run `sauf build` ``. tsc does not run `laratype:di`, so a class resolved by constructor DI fails in production (`Cannot autowire <Class>: ... no dependency metadata was found`): the build has no dependency metadata transform, and only `sauf dev` runs the [plugin chain](#plugin-chain).
  - **Runtime:** the entry (`sauf dev` and the `sauf` CLI in dev, `dist/index.js` and `dist/cli.js` in production) loads the manifest and calls `setAppManifest()` before the providers boot. `register()` (providers), `ConfigLoadServiceProvider` (`config`), `PassportServiceProvider` (`auth`, the `PersonalAccessToken` model), `DatabaseServiceProvider` (models), the CLI (commands, `app/routes/console.ts`) and `db:seed` (seeders) read `appManifest()`, which throws `No app manifest: start the app with ...` when no entry set one. `DatabaseServiceProvider` imports every model before it connects: a model that fails to import fails the database boot. `db:seed --class` takes the seeder's path in the seeders folder, with `/` or `\`, `./`, `..` or a doubled separator (normalised), and with or without its extension (`Admin\UserSeeder`, `./Admin//UserSeeder`, `UserSeeder.ts`). A command file that fails to import is skipped, with a warning naming the file, then its error and stack (`Skipped <file>: the command file failed to load`), as a scan error is, and so is an `app/routes/console.ts` that fails to import: the other commands, `--help`, `types:generate` and `make:*` still run. A command file whose default export is not a command class (a class with a static `signature`) is skipped, with one warning naming the files. `db:seed` with an unknown seeder prints `Seeder class <name> not found in the seeders folder (app/database/seeders or database/seeders)` and exits 1. Without `@laratype/database`, `db:*` fails with `Database package is not installed. Please install it with ...`.
  - `getAppPath()` of `@laratype/support` is deprecated: the framework no longer calls it, and it stays for 0.5 user code until [#135](https://github.com/Laratypes/Laratype/issues/135). In production it resolves against the `appDir` of `dist/app.manifest.js` (`dist/<appDir>/<path>`, globs and folders included) without TypeScript or probing, and against `dist/<path>` when there is none, as in 0.5.
- **Contract tree:** in dev, `laratype:api` (merged, [#104](https://github.com/Laratypes/Laratype/issues/104); in the `warmup.ts` plugin list after `laratype:di` and before SWC) resolves `$api` and scans the [contract folder tree](./contract.md#contract-folder-tree) the first time the app imports it. `sauf dev --hmr` rescans before a restart when a contract or `_scope.ts` is added or deleted under the root, or the config file changes ([http.md › Router v2](./http.md#router-v2)). Everything else (regenerating without a restart, and for the FE) stays planned → [#142](https://github.com/Laratypes/Laratype/issues/142). Production does no scanning (merged, [#125](https://github.com/Laratypes/Laratype/issues/125)): the build script runs `sauf types:generate` before `tsc`, which compiles `.laratype/api/index.gen.ts` into `dist/.laratype/api/index.gen.js` next to the compiled contracts, and `sauf build` (`tsc-alias`) rewrites `$api` to it. Folding these steps into `sauf build` is B3 [#127](https://github.com/Laratypes/Laratype/issues/127).
- **`laratype:di` (T2):**
  - runs `transformDi` with `enforce: 'pre'`, before `RollupPluginSwc`;
  - resolves `virtual:laratype/di` to `@laratype/core` and chains source maps;
  - works with the HMR restart;
  - Done when `sauf dev` on `examples/basic` resolves a controller with constructor DI.
- **SWC:** keeps `decoratorMetadata: true` while TypeORM is in use ([#88](https://github.com/Laratypes/Laratype/issues/88)).
- **Alias:** resolved in the bundler, which removes `tsc-alias`. It also resolves `$api` to the generated `.laratype/api/index.gen.ts` ([contract.md › Contract folder tree](./contract.md#contract-folder-tree)).
- **Shared (B2):** one `laratypePlugins()` used by `warmup.ts`, `dev.ts`, `sauf build` and the vitest preset. Done when dev and build produce the same DI metadata snapshot.

### Acceptance
[#102 Done when](https://github.com/Laratypes/Laratype/issues/102) · [#125 Done when](https://github.com/Laratypes/Laratype/issues/125) · [#126 Done when](https://github.com/Laratypes/Laratype/issues/126)

---

## sauf build steps

### Status
planned → [#127](https://github.com/Laratypes/Laratype/issues/127) (B3), [#128](https://github.com/Laratypes/Laratype/issues/128) (B4), [#129](https://github.com/Laratypes/Laratype/issues/129) (B5), [#130](https://github.com/Laratypes/Laratype/issues/130) (B6). The typegen step is [#133](https://github.com/Laratypes/Laratype/issues/133). Platforms: [#172](https://github.com/Laratypes/Laratype/issues/172), [#173](https://github.com/Laratypes/Laratype/issues/173), [#155](https://github.com/Laratypes/Laratype/issues/155), [#156](https://github.com/Laratypes/Laratype/issues/156).

### Design (non-binding)

| Step | What | Output | Fails the build? |
|---|---|---|---|
| 1. typecheck (B3) | `tsc --noEmit`; skip with `--no-typecheck` | none | yes |
| 2. bundle (B4) | Vite SSR build with the [plugin chain](#plugin-chain); dependencies stay external; source maps | `dist/server.js`, `dist/cli.js` | yes |
| 3. verify (B5) | Dry-run boot (no listen, no DB): DI graph, route registry, bindings, policies | none | yes |
| 4. typegen (G1) | `sauf types:generate` ([typegen.md](./typegen.md)) | types + `openapi.json` | yes |
| 5. adapter (B6) | Entry per `--platform`: `node` (reuse `packages/sauf/src/adapters/node`), `bun` | `dist/index.js` | n/a |

- **App scripts:** become `"build": "sauf build"` and `"start": "node dist/index.js"`. B4 is done when `node dist/index.js` serves `examples/basic`.
- **Verify step:** B5 is done when removing a binding fails the build with a clear message. It uses D5b's boot-time graph diagnostics ([#113](https://github.com/Laratypes/Laratype/issues/113)).
- **More platforms:**
  - Heroku: `--platform node` reads `$PORT`, plus a Procfile (#172);
  - Vercel adapter (#173);
  - `--standalone`, which bundles dependencies (#155);
  - Cloudflare and Deno (#156).

### Acceptance
[#127](https://github.com/Laratypes/Laratype/issues/127) · [#128](https://github.com/Laratypes/Laratype/issues/128) · [#129](https://github.com/Laratypes/Laratype/issues/129) · [#130](https://github.com/Laratypes/Laratype/issues/130) Done when

---

## Testing preset

### Status
planned → [#131](https://github.com/Laratypes/Laratype/issues/131) (B7, `@laratype/testing`).

### Design (non-binding)
- Vitest uses esbuild by default, so it would skip the DI transform and decorator metadata.
- `defineLaratypeConfig()` therefore reuses the [plugin chain](#plugin-chain).
- `createTestApp()` boots from the manifest and provides `app.swap()` and a typed `request()`. That `request()` is typed by `AppApi`, the type of the generated `appApi`; `AppRouter` is retired.
- Tests fail when an endpoint throws an error it doesn't declare, and `sauf test` reports declared errors no test triggers ([http.md › Undeclared-error check](./http.md#undeclared-error-check)).
- Done when the `examples/basic` tests run through the preset.

### Acceptance
[#131 Done when](https://github.com/Laratypes/Laratype/issues/131)

---

## Browser targets and budgets

### Status
planned → [#132](https://github.com/Laratypes/Laratype/issues/132) (B8).

### Design (non-binding)
- `@laratype/contract` and `@laratype/client` build with `target: 'browser'` and `sideEffects: false`.
- CI checks:
  - no `node:*` imports;
  - the size budget: the runtime of client + contract stays **under 5 kB gzip**, excluding the schema library ([client.md › Bundle budget](./client.md#bundle-budget));
  - an FE fixture that type-checks against `dist/`.
- The source-level browser-safety check already exists. `packages/contract/__tests__/typecheck.test.ts` compiles `src` with `lib: [ES2022, DOM]` and `types: []` (merged @ d70daa7).

### Acceptance
[#132 Done when](https://github.com/Laratypes/Laratype/issues/132)

---

## Bun DI plugin

### Status
proposed: PR #324 @ 6d0af35 (T4 [#116](https://github.com/Laratypes/Laratype/issues/116)).

### Invariants
- `bun.build.js` runs `laratypeDiBun()` (`packages/sauf/src/di/bun.ts`), the same core transform as `laratype:di`, on the ESM and CJS builds of every package that lists `@laratype/core` in `dependencies` (not `@laratype/core` itself; today `@laratype/http`, `@laratype/support`, `@laratype/auth`, `@laratype/log` and `laratype`), on its own `src/` only. Framework classes resolved by the container then work from `dist/`. Public API, invariants, diagnostics, example and non-goals: [di.md › Bun build plugin](./di.md#bun-build-plugin); this section only records the build wiring.

### Acceptance
[#116 Done when](https://github.com/Laratypes/Laratype/issues/116)

---

## CI and release

### Status
Partly merged ([#189](https://github.com/Laratypes/Laratype/issues/189)): pkg-pr-new previews and LF line endings. Workflow hardening is planned → [#189](https://github.com/Laratypes/Laratype/issues/189) (B14), and the npm release → [#190](https://github.com/Laratypes/Laratype/issues/190) (B15).

### Invariants
- **`pkg-preview.yml` publishes a pkg.pr.new preview of every public package** (pkg-pr-new skips `"private": true` ones), on each PR from a branch of this repo (any base; fork PRs are skipped) and on push to `master`, only in `Laratypes/Laratype` (forks skip it). Changes that touch only `docs/**` or root-level `*.md` files publish nothing (`paths-ignore`); a `.md` file inside a package (none today) would still publish, since npm packs it. On `master`, the latest commit of a burst of pushes that changes anything else is published, intermediate ones may be skipped (GitHub keeps one pending run per concurrency group and replaces it), and docs-only commits publish nothing. It runs with `permissions: contents: read` and no secrets; the pkg.pr.new GitHub App posts the install links. It packs with `bun pm pack` (`--bun`), because `npm pack` leaves `catalog:` specifiers unresolved. Peers are packed as plain versions, not preview URLs, so a preview of a package with workspace peers is installed together with those peers' previews.
- **Required: Settings › Actions › General › "Approval for running fork pull request workflows from contributors" must be set to "all external contributors".** A `pull_request` run uses the workflow file from the PR's merge ref, so a fork PR can remove `pkg-preview.yml`'s job-level `if:` that skips forks, and publish installable packages under the Laratypes pkg.pr.new namespace. The `if:` only skips the normal case; the approval is the control.
- **Text files are LF in the repo and in every checkout.** `.gitattributes` sets `* text=auto eol=lf` and marks `*.png` binary, so `core.autocrlf=true` on Windows no longer checks fixtures and snapshots out as CRLF.

### Design (non-binding)
- **B14:** one CI. Since H16 ([#184](https://github.com/Laratypes/Laratype/issues/184)), `ci.yml` runs the full test suite after the build, `check:dist` and `check:pkg`, including `devSsr.test.ts` and `docs/v1/examples/typecheck.test.ts`. What is left of B14 is workflow hardening and removing `github_actions_security.yml` from the branches that inherited it. The stacked-PR retarget note is in [AGENTS.md › Stacked PRs](../../AGENTS.md#stacked-prs).
- **B15:** npm releases with Trusted Publishing (OIDC), provenance and changesets.
- Review agent-instruction, `.github/` and tooling changes in a branch's diff from a session outside its checkout, before you base work on the branch or review its PR and before any agent session or `bun install` runs there: see [CONTRIBUTING.md › Security](../../CONTRIBUTING.md#security).

### Acceptance
[#189 Done when](https://github.com/Laratypes/Laratype/issues/189) · [#190 Done when](https://github.com/Laratypes/Laratype/issues/190)
