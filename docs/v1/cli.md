---
area: cli
packages: ["sauf", "@laratype/console"]
issues: [102, 104, 125, 126, 127, 128, 129, 130, 133, 134, 142, 148, 149, 155, 156, 157, 168, 169, 171, 172, 173, 179, 180]
verified-against: Laratype@256a743 (0.5 state also checked on v0.5.4 @ 053be38)
last-verified: 2026-10-10
---

# CLI

The `sauf` command line: the v1 command list, `sauf dev`, the `sauf build` options and the `make:*` generators. App-defined console commands are specified in [services.md › Console commands](./services.md#console-commands).

> **Planned only.** On master, `sauf` is the 0.5 CLI. Every section is `planned → #N` and holds a **Design (non-binding)** note built from the issue bodies. Public API, Invariants, Diagnostics and Example are left out until code lands ([README](./README.md)).

**State on master (0.5):**
- **Framework commands:** `dev`, `build`, `db:init`, `db:seed`, `route:list`, and ten generators: `make:command`, `make:controller`, `make:factory`, `make:gate`, `make:middleware`, `make:model`, `make:policy`, `make:request`, `make:resource`, `make:seeder` ([`commands/index.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/sauf/src/commands/index.ts)).
- **`sauf dev` options:** `-p, --port` (default `3000`), `-H, --host` (default `localhost`) and `--hmr` ([`dev.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/sauf/src/commands/dev.ts#L17-L21)). `v0.5.4` has `--port` and `--host` only.
- **`sauf build` options:** `-p, --platform` (default `node`) ([`build.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/sauf/src/commands/build.ts#L18-L20)). `node` is the only platform that `utils/build/platform.ts` accepts.
- **App commands** are loaded by path: `app/src/console/commands/*.ts` and the default export of `app/routes/console.ts` ([`sauf/src/utils/index.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/sauf/src/utils/index.ts#L10-L34)).

| Section | Status |
|---|---|
| [Command list](#command-list) | planned → #126, #133, #104, #134, #148, #149, #168, #169, #171, #179, #180 |
| [sauf dev](#sauf-dev) | planned → #126, #102, #142, #157 |
| [sauf build options](#sauf-build-options) | planned → #127, #130, #172, #173, #155, #156 |
| [make:* generators](#make-generators) | planned → #134 |

---

## Command list

### Status
planned → each command's issue, in the table below.

### Design (non-binding)
Every v1 command named in a spec file or an issue body. A command that is only implied by an issue is listed under Open questions instead.

| Command | Purpose | Status | Spec |
|---|---|---|---|
| `sauf dev` | Dev server on the shared plugin chain | planned → #126 | [sauf dev](#sauf-dev) |
| `sauf build` | Production build: typecheck, bundle, verify, typegen, adapter | planned → #127, #128, #129, #130 | [build.md › sauf build steps](./build.md#sauf-build-steps), [options](#sauf-build-options) |
| `sauf types:generate` | Writes `api.ts` for a separate-repo FE | planned → #133 | [typegen.md › sauf types:generate](./typegen.md#sauf-typesgenerate) |
| `sauf route:list` | Lists the route registry | planned → #104 | [http.md › Router v2](./http.md#router-v2) |
| `sauf make:*` | Generators from stubs | planned → #134 | [make:* generators](#make-generators) |
| `sauf db:introspect` | Generates the `Database` interface from the schema | planned → #148 | [database.md › Migrations and introspection](./database.md#migrations-and-introspection) |
| `sauf db:seed` | Runs the seeders | planned → #149 | [database.md › Factories and seeders](./database.md#factories-and-seeders) |
| `sauf queue:work`, `queue:failed`, `queue:retry` | Queue worker and failed jobs | planned → #169 (Procfile: #172) | [services.md › Queue](./services.md#queue) |
| `sauf schedule:run`, `schedule:work`, `schedule:list` | Scheduler | planned → #171 (Vercel Cron: #173) | [services.md › Scheduler](./services.md#scheduler) |
| `sauf storage:link` | Not described in #168 | planned → #168 | [services.md › Storage](./services.md#storage) |
| `sauf oauth:keys` | Generates the OAuth2 JWT keys | planned → #179 | [auth.md › OAuth2 server](./auth.md#oauth2-server) |
| `sauf oauth:client` | OAuth2 clients, including personal access clients | planned → #180 | [auth.md › OAuth2 server](./auth.md#oauth2-server) |

App commands (for example `send:mail` in `examples/basic`) are resolved by the container ([services.md › Console commands](./services.md#console-commands)).

### Open questions
- The 0.5 command `db:init` has no v1 issue → [#148](https://github.com/Laratypes/Laratype/issues/148)
- The command that runs migrations (#148 names a migration runner, and #172 runs migrations in the Heroku release phase, but neither names a command) → [#148](https://github.com/Laratypes/Laratype/issues/148)
- The command that purges expired OAuth2 tokens (#180 names none) → [#180](https://github.com/Laratypes/Laratype/issues/180)

### Acceptance
Each command's issue, linked in the table.

---

## sauf dev

### Status
planned → [#126](https://github.com/Laratypes/Laratype/issues/126) (B2, shared chain), [#102](https://github.com/Laratypes/Laratype/issues/102) (T2, DI plugin), [#142](https://github.com/Laratypes/Laratype/issues/142) (G2, type watch), [#157](https://github.com/Laratypes/Laratype/issues/157) (X3, `--strict-contract`).

### Design (non-binding)
- **Plugin chain:** `sauf dev` uses the same chain as `sauf build` and the test preset, with the DI transform before SWC ([build.md › Plugin chain](./build.md#plugin-chain)). The app boots from the build manifest (B1 [#125](https://github.com/Laratypes/Laratype/issues/125)).
- **Type watch:** it watches `app/contracts/**` and writes incremental types to `.laratype/types/` ([typegen.md › Watch mode in sauf dev](./typegen.md#watch-mode-in-sauf-dev)).
- **`--strict-contract`:** warns or fails when a thrown error or a response does not match the contract ([http.md › Strict contract mode](./http.md#strict-contract-mode)).

### Open questions
- Which 0.5 options (`--port`, `--host`, `--hmr`) carry over to v1 → [#126](https://github.com/Laratypes/Laratype/issues/126)

### Acceptance
[#126 Done when](https://github.com/Laratypes/Laratype/issues/126) · [#157 Done when](https://github.com/Laratypes/Laratype/issues/157)

---

## sauf build options

### Status
planned → [#127](https://github.com/Laratypes/Laratype/issues/127) (B3), [#130](https://github.com/Laratypes/Laratype/issues/130) (B6), [#172](https://github.com/Laratypes/Laratype/issues/172) (B9), [#173](https://github.com/Laratypes/Laratype/issues/173) (B10), [#155](https://github.com/Laratypes/Laratype/issues/155) (X1), [#156](https://github.com/Laratypes/Laratype/issues/156) (X2).

### Design (non-binding)
The build steps are specified in [build.md › sauf build steps](./build.md#sauf-build-steps). The options named so far:

| Option | Effect | Issue |
|---|---|---|
| `--no-typecheck` | Skips the `tsc --noEmit` step | #127 |
| `--platform node`, `--platform bun` | Entry for Node or Bun. For Heroku, the node adapter listens on `0.0.0.0:$PORT` (and `HOST`) when set | #130, #172 |
| `--platform vercel` | Build Output API layout (`.vercel/output`) | #173 |
| `--standalone` | Bundles the dependencies too | #155 |

### Open questions
- The option names for the Cloudflare and Deno adapters → [#156](https://github.com/Laratypes/Laratype/issues/156)

### Acceptance
[#127](https://github.com/Laratypes/Laratype/issues/127) · [#130](https://github.com/Laratypes/Laratype/issues/130) · [#172](https://github.com/Laratypes/Laratype/issues/172) · [#173](https://github.com/Laratypes/Laratype/issues/173) · [#155](https://github.com/Laratypes/Laratype/issues/155) · [#156](https://github.com/Laratypes/Laratype/issues/156) Done when

---

## make:* generators

### Status
planned → [#134](https://github.com/Laratypes/Laratype/issues/134) (E2, M2). Depends on H2 #105, H9 #123. Templates live under `packages/sauf/src/commands/make`.

### Design (non-binding)
- **New:** `make:contract`.
- **Updated to the v1 API:** the controller template ([http.md › Controller typing](./http.md#controller-typing-ctx-and-controllerof)), the request template ([validation.md › FormRequest v2](./validation.md#formrequest-v2)) and the resource template ([http.md › Resources](./http.md#resources)).
- **Generated files type-check** in `examples/basic`.
- **Stub rules** (carried from C3 [#91](https://github.com/Laratypes/Laratype/issues/91) and S2 [#85](https://github.com/Laratypes/Laratype/issues/85); see [overview.md › Cross-cutting rules](./overview.md#cross-cutting-rules)):
  - stubs import `import * as z from "zod"`. `import { z } from "zod/v4"` grows the FE bundle from about 16 KiB to 47 KiB gzip;
  - contract and request stubs write `z.coerce.number<number>()`, because zod 4's `z.coerce.number()` has input type `unknown`;
  - `zod/v4-mini` (about 8.3 KiB) is the recommendation for FE bundles.

### Open questions
- What happens in v1 to the 0.5 generators #134 does not mention (`make:command`, `make:factory`, `make:gate`, `make:middleware`, `make:model`, `make:policy`, `make:seeder`) → [#134](https://github.com/Laratypes/Laratype/issues/134)
- Generators for the v1 services (jobs, events, listeners, mailables) are implied by those services but named by no issue → [#134](https://github.com/Laratypes/Laratype/issues/134)

### Acceptance
[#134 Done when](https://github.com/Laratypes/Laratype/issues/134)
