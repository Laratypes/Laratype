---
area: build
packages: ["sauf", "@laratype/testing"]
issues: [102, 116, 125, 126, 127, 128, 129, 130, 131, 132, 155, 156, 172, 173, 185, 187, 188, 189, 190, 191]
verified-against: Laratype@d70daa7 (+ PR #193 @ ccf9894, PR #198 @ 28d0c20, PR #203 @ 16080c9)
last-verified: 2026-10-09
---

# Build

v1 has one plugin chain for `sauf dev`, `sauf build` and tests, so DI metadata and decorators behave the same everywhere. Production builds are bundled, verified and type-generated. This file also records the packaging constraints the framework packages must keep.

**State on master (0.5):**
- **Dev** (`sauf dev`) uses Vite SSR with `RollupPluginSwc` (`packages/sauf/src/bin/warmup.ts`, `utils/plugin.ts`) and an HMR restart (`commands/dev.ts`).
- **Production** builds compile with `tsc -b tsconfig.build.json`, then `sauf build` copies the `cli.js` / node adapter entries and runs `tsc-alias` (`commands/build.ts`).
- **Discovery:** the runtime finds config, routes, providers and commands by file path (`packages/support/src/path-resolver/pathResolver.ts`).
- **Framework packages** build with `bun.build.js` (ESM + CJS), then `tsc` + `rollup-plugin-dts`.

| Section | Status |
|---|---|
| [Package build fixes (B11–B13)](#package-build-fixes-b11b13) | proposed: PR #193 @ ccf9894 → PR #198 @ 28d0c20 → PR #203 @ 16080c9 |
| [Packaging follow-ups (B16)](#packaging-follow-ups-b16) | planned → #191 |
| [Plugin chain](#plugin-chain) | planned → #102, #125, #126 |
| [sauf build steps](#sauf-build-steps) | planned → #127, #128, #129, #130, #172, #173, #155, #156 |
| [Testing preset](#testing-preset) | planned → #131 |
| [Browser targets and budgets](#browser-targets-and-budgets) | planned → #132 |
| [Bun DI plugin](#bun-di-plugin) | planned → #116 |
| [CI and release](#ci-and-release) | planned → #189, #190 |

---

## Package build fixes (B11–B13)

### Status
Three stacked PRs, which merge in this order:
1. proposed: PR #193 @ ccf9894 (B13 [#188](https://github.com/Laratypes/Laratype/issues/188), base master);
2. proposed: PR #198 @ 28d0c20 (B12 [#187](https://github.com/Laratypes/Laratype/issues/187), base #193);
3. proposed: PR #203 @ 16080c9 (B11 [#185](https://github.com/Laratypes/Laratype/issues/185), base #198).

### Public API
No public API. These are build configuration and scripts:
- B13 changes `bun.build.js` and `packages/sauf/build.config.js`, and adds `bun run check:dist`.
- B12 adds the regression test `packages/sauf/__tests__/devSsr.test.ts`.
- B11 sets `"verbatimModuleSyntax": true` in `tsconfig.app.json` and `examples/basic/tsconfig.build.json`.

### Invariants
Constraints every package build must keep once these PRs merge:
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
- CI wiring of `check:dist` and `devSsr.test.ts` → [#189](https://github.com/Laratypes/Laratype/issues/189)
- Removing the `HTTP_APP` `globalThis` workaround after B13 → [#188](https://github.com/Laratypes/Laratype/issues/188) follow-up

### Acceptance
[#188 Done when](https://github.com/Laratypes/Laratype/issues/188) · [#187 Done when](https://github.com/Laratypes/Laratype/issues/187) · [#185 Done when](https://github.com/Laratypes/Laratype/issues/185)

---

## Packaging follow-ups (B16)

### Status
planned → [#191](https://github.com/Laratypes/Laratype/issues/191) (B16).

### Design (non-binding)
Fixes listed in #191:
- **Missing file:** support's `./env` export points to `env.d.ts`, which isn't in `files`.
- **hono:** must be a peer dependency of http, support and laratype. support currently inlines a second Hono copy.
- **Runtime imports declared only as devDependencies:** `glob` and `mlly` in support must move to real dependencies. `check:dist` is extended to catch this.
- **Entry points:** check `main` / `exports` for every package.
- **Empty packages** (broadcast, i18n, mail, schedule, storage, ts-gen) are marked `private: true` until they are implemented.
- **Package lint:** `publint` and `@arethetypeswrong/cli` must pass for every public package.

### Acceptance
[#191 Done when](https://github.com/Laratypes/Laratype/issues/191)

---

## Plugin chain

### Status
planned → [#102](https://github.com/Laratypes/Laratype/issues/102) (T2, DI plugin in `sauf dev`), [#125](https://github.com/Laratypes/Laratype/issues/125) (B1, manifest), [#126](https://github.com/Laratypes/Laratype/issues/126) (B2, shared chain). The DI transform core itself is proposed: PR #194 ([di.md › DI transform](./di.md#di-transform)).

### Design (non-binding)
```
laratype:manifest  →  laratype:di  →  swc (decorators for the ORM)  →  alias (tsconfig paths)
```
- **`laratype:manifest` (B1):** a virtual module `virtual:laratype/app` with static imports of providers, configs, routes, commands, models, migrations and seeders. It replaces runtime path discovery, which prevents bundling. Done when dev boots from the manifest.
- **`laratype:di` (T2):**
  - runs `transformDi` with `enforce: 'pre'`, before `RollupPluginSwc`;
  - resolves `virtual:laratype/di` to `@laratype/core` and chains source maps;
  - works with the HMR restart;
  - Done when `sauf dev` on `examples/basic` resolves a controller with constructor DI.
- **SWC:** keeps `decoratorMetadata: true` while TypeORM is in use ([#88](https://github.com/Laratypes/Laratype/issues/88)).
- **Alias:** resolved in the bundler, which removes `tsc-alias`.
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
- `createTestApp()` boots from the manifest and provides `app.swap()` and a typed `request()`. That `request()` is typed by `AppApi`; `AppRouter` is retired.
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
planned → [#189](https://github.com/Laratypes/Laratype/issues/189) (B14, CI consolidation), [#190](https://github.com/Laratypes/Laratype/issues/190) (B15, npm release).

### Design (non-binding)
- **B14:** one CI that runs the tests not wired today. Those are `check:dist`, `devSsr.test.ts`, `bun run test:di` (T3) and `docs/v1/examples/typecheck.test.ts`. B14 also covers pkg-pr-new previews and workflow hardening.
- **B15:** npm releases with Trusted Publishing (OIDC), provenance and changesets.
- `.github/` changes need user review.

### Acceptance
[#189 Done when](https://github.com/Laratypes/Laratype/issues/189) · [#190 Done when](https://github.com/Laratypes/Laratype/issues/190)
