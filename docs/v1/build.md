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
- **Production** builds compile with `tsc -b tsconfig.build.json`, then `sauf build` copies the `cli.js` / node adapter entries and runs `tsc-alias` (`commands/build.ts`).
- **Discovery:** the runtime finds config, routes, providers and commands by file path (`packages/support/src/path-resolver/pathResolver.ts`).
- **Framework packages** build with `bun.build.js` (ESM + CJS), then `tsc` + `rollup-plugin-dts`.

| Section | Status |
|---|---|
| [Package build fixes (B11–B13)](#package-build-fixes-b11b13) | merged @ 2ad49ad (B13), acf9f2a (B13 CI), e3112eb (B12), f66eafd (B11) |
| [Packaging follow-ups (B16)](#packaging-follow-ups-b16) | merged ([#191](https://github.com/Laratypes/Laratype/issues/191)); `bun run check:pkg` lints every public package |
| [Plugin chain](#plugin-chain) | T2 merged ([#102](https://github.com/Laratypes/Laratype/issues/102)); planned → #125, #126 |
| [sauf build steps](#sauf-build-steps) | planned → #127, #128, #129, #130, #172, #173, #155, #156 |
| [Testing preset](#testing-preset) | planned → #131 |
| [Browser targets and budgets](#browser-targets-and-budgets) | planned → #132 |
| [Bun DI plugin](#bun-di-plugin) | planned → #116 |
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
  - `hono` (`^4.6.18`) for http, support and laratype;
  - `zod` (`^3.25.0`) for http and validation, whose `.d.ts` import zod.
  - Optional workspace peers for imports that are type-only or loaded on demand: support → http; http → auth; laratype → http, auth; sauf → laratype, database.
  - support also has `passport` and `@types/passport` as optional peers (the auth config type).
- **Dependencies** that were devDependencies:
  - support: `dotenv`, `glob`, `mlly`, `ts-toolbelt`;
  - http: `es-toolkit`;
  - auth: `jsonwebtoken`, `@types/jsonwebtoken`, `@types/passport`, plus the workspace packages it imports (`@laratype/console`, `@laratype/database`);
  - database: `glob`, `reflect-metadata`;
  - console: `@laratype/support`;
  - sauf: the CLI's imports (`commander`, `glob`, `handlebars`, `figlet`, `kolorist`, `@hono/node-server`, the rollup plugins and `rollup`).
- **support** ships `env.d.ts` (`@laratype/support/env`), and its `module` field points at `./dist/index.esm.js`.
- **sauf**'s `bin` dist starts with `#!/usr/bin/env node` (`buildOptions.banner`).
- **broadcast, i18n, mail, schedule, storage and ts-gen** are `private: true` until they have code.
- **`bun run check:pkg`** (`scripts/check-packages.mjs`) runs `publint --strict` and `attw --pack` on every public package. It is not a CI step.

### Invariants
- **Every runtime import of a third-party package is in `dependencies` or `peerDependencies`.** bun.build.js keeps those external. A runtime import declared only in devDependencies is bundled into the dist, which ships a second copy (hono's `HTTPException` / `instanceof`). `check:dist` fails on it.
- **A package that exposes another package's types or instances is a peer of it** (hono, zod, typeorm, dayjs). Packages that are only used internally are `dependencies`.
- **Packages the public `.d.ts` imports are declared too**, as a dependency or a peer (an optional peer when the import is type-only and the edge would be circular). Types-only packages the `.d.ts` needs (`@types/*`, `ts-toolbelt`) are `dependencies`, unless the matching runtime package is an optional peer (support's `@types/passport`).
- **Peer ranges are explicit** (`^4.6.18`), never `catalog:`. The workspace keeps the `catalog:` devDependency for its own install.
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
The DI plugin in `sauf dev` (T2) is merged ([#102](https://github.com/Laratypes/Laratype/issues/102)). planned → [#125](https://github.com/Laratypes/Laratype/issues/125) (B1, manifest), [#126](https://github.com/Laratypes/Laratype/issues/126) (B2, shared chain). The DI transform core itself is merged @ 8dc389b ([di.md › DI transform](./di.md#di-transform)).

### Design (non-binding)
```
laratype:manifest  →  laratype:di  →  swc (decorators for the ORM)  →  alias (tsconfig paths)
```
- **`laratype:manifest` (B1):** a virtual module `virtual:laratype/app` with static imports of providers, configs, routes, commands, models, migrations and seeders. It replaces runtime path discovery, which prevents bundling. Done when dev boots from the manifest.
- **Contract tree:** in dev the server scans the [contract folder tree](./contract.md#contract-folder-tree) at startup and rescans on change. The production build writes the tree into the manifest, so production does no scanning ([#104](https://github.com/Laratypes/Laratype/issues/104)).
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
planned → [#116](https://github.com/Laratypes/Laratype/issues/116) (T4).

### Design (non-binding)
Exposes the same core transform as a Bun plugin in `bun.build.js`, so framework classes resolved by the container work from `dist/` ([di.md › Bun build plugin](./di.md#bun-build-plugin)).

### Acceptance
[#116 Done when](https://github.com/Laratypes/Laratype/issues/116)

---

## CI and release

### Status
Partly merged ([#189](https://github.com/Laratypes/Laratype/issues/189)): pkg-pr-new previews and LF line endings. Workflow hardening is planned → [#189](https://github.com/Laratypes/Laratype/issues/189) (B14), and the npm release → [#190](https://github.com/Laratypes/Laratype/issues/190) (B15).

### Invariants
- **`pkg-preview.yml` publishes a pkg.pr.new preview of every package that has a `dist`**, on each PR (any base) and on push to `master`. It runs with `permissions: contents: read` and no secrets; the pkg.pr.new GitHub App posts the install links. It packs with `bun pm pack` (`--bun`), because `npm pack` leaves `catalog:` specifiers unresolved. pkg-pr-new skips `"private": true` packages.
- **Text files are LF in the repo and in every checkout.** `.gitattributes` sets `* text=auto eol=lf` and marks `*.png` binary, so `core.autocrlf=true` on Windows no longer checks fixtures and snapshots out as CRLF.

### Design (non-binding)
- **B14:** one CI that runs the tests not wired today. Those are `devSsr.test.ts` and `docs/v1/examples/typecheck.test.ts`; `check:dist` (acf9f2a) and the T3 DI tests (b560fc9) already run in CI. B14 also covers workflow hardening.
- **B15:** npm releases with Trusted Publishing (OIDC), provenance and changesets.
- `.github/` changes need user review.

### Acceptance
[#189 Done when](https://github.com/Laratypes/Laratype/issues/189) · [#190 Done when](https://github.com/Laratypes/Laratype/issues/190)
