---
area: cli
packages: ["sauf", "@laratype/console"]
issues: [102, 104, 125, 126, 127, 128, 129, 130, 133, 134, 142, 148, 149, 155, 156, 157, 168, 169, 171, 172, 173, 179, 180]
verified-against: Laratype@256a743 (0.5 state also checked on v0.5.4 @ 053be38; + make:command at f10c36c; + make:* at 7c1590c)
last-verified: 2026-11-12
---

# CLI

The `sauf` command line: the v1 command list, `sauf dev`, the `sauf build` options and the `make:*` generators. App-defined console commands are specified in [services.md › Console commands](./services.md#console-commands).

> **Planned only, except the `make:*` generators and the sections whose Status says merged.** On master, `sauf` is the 0.5 CLI. A section marked `planned → #N` holds a **Design (non-binding)** note built from the issue bodies. Public API, Invariants, Diagnostics and Example are left out until code lands ([README](./README.md)).

**State on master (0.5):**
- **Framework commands:** `dev`, `build`, `db:init`, `db:seed`, `route:list`, and ten generators: `make:command`, `make:controller`, `make:factory`, `make:gate`, `make:middleware`, `make:model`, `make:policy`, `make:request`, `make:resource`, `make:seeder` ([`commands/index.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/sauf/src/commands/index.ts)).
- **`sauf dev` options:** `-p, --port` (default `3000`), `-H, --host` (default `localhost`) and `--hmr` ([`dev.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/sauf/src/commands/dev.ts#L17-L21)). `v0.5.4` has `--port` and `--host` only.
- **`sauf build` options:** `-p, --platform` (default `node`) ([`build.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/sauf/src/commands/build.ts#L18-L20)). `node` is the only platform that `utils/build/platform.ts` accepts.
- **App commands** are loaded by path: `app/src/console/commands/*.ts` and the default export of `app/routes/console.ts` ([`sauf/src/utils/index.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/sauf/src/utils/index.ts#L10-L34)).

| Section | Status |
|---|---|
| [Command list](#command-list) | `types:generate` merged ([#133](https://github.com/Laratypes/Laratype/issues/133)); `route:list` reads the Router v2 registry, merged ([#104](https://github.com/Laratypes/Laratype/issues/104)); `make:*` proposed (see below); planned → #126, #148, #149, #168, #169, #171, #179, #180 |
| [sauf dev](#sauf-dev) | DI plugin merged ([#102](https://github.com/Laratypes/Laratype/issues/102)); planned → #126, #142, #157 |
| [sauf build options](#sauf-build-options) | planned → #127, #130, #172, #173, #155, #156 |
| [make:* generators](#make-generators) | proposed: PR [#366](https://github.com/Laratypes/Laratype/pull/366) @ 7c1590c (E2 [#134](https://github.com/Laratypes/Laratype/issues/134)); `make:command` merged in PR [#357](https://github.com/Laratypes/Laratype/pull/357) (F2 [#161](https://github.com/Laratypes/Laratype/issues/161)), with its name check in #366 |

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
| `sauf types:generate` | Writes `$types.d.ts` and `.laratype/api/index.gen.ts` from the contract tree, and `api.ts` for a separate-repo FE | merged ([#133](https://github.com/Laratypes/Laratype/issues/133)) | [typegen.md › sauf types:generate](./typegen.md#sauf-typesgenerate) |
| `sauf test` | Runs the tests and lists declared errors that no test triggers | planned → #157 | [http.md › Undeclared-error check](./http.md#undeclared-error-check) |
| `sauf route:list` | Lists the route registry: `Route.api` entries (name, method, path, controller, middleware, scope and contract policies, a "Not enforced" column for auth and authorize until #105/#121 and headers schema validation (no tracking issue yet), domain) and 0.5 routes | merged ([#104](https://github.com/Laratypes/Laratype/issues/104)) | [http.md › Router v2](./http.md#router-v2) |
| `sauf make:*` | Generators from stubs | proposed: PR [#366](https://github.com/Laratypes/Laratype/pull/366) @ 7c1590c (E2 [#134](https://github.com/Laratypes/Laratype/issues/134)) | [make:* generators](#make-generators) |
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
The DI plugin (T2) is merged ([#102](https://github.com/Laratypes/Laratype/issues/102)). planned → [#126](https://github.com/Laratypes/Laratype/issues/126) (B2, shared chain), [#142](https://github.com/Laratypes/Laratype/issues/142) (G2, type watch), [#157](https://github.com/Laratypes/Laratype/issues/157) (X3, undeclared-error check).

### Design (non-binding)
- **Plugin chain:** `sauf dev` uses the same chain as `sauf build` and the test preset, with the DI transform before SWC ([build.md › Plugin chain](./build.md#plugin-chain)). The app boots from the app manifest (B1, merged [#125](https://github.com/Laratypes/Laratype/issues/125)).
- **Type watch:** it watches the [contract folder tree](./contract.md#contract-folder-tree) for file add, rename and delete, and writes `$types.d.ts` under `.laratype/types/` and `.laratype/api/index.gen.ts` (`$api`) ([typegen.md › Watch mode in sauf dev](./typegen.md#watch-mode-in-sauf-dev)).
- **Options:** `-p, --port`, `-H, --host` and `--hmr` carry over from 0.5. HMR stays opt-in through `--hmr` ([#126](https://github.com/Laratypes/Laratype/issues/126)).
- **Undeclared errors:** an error thrown but not declared on the running endpoint is reported loudly, with the stack. The check is always on, so there is no `--strict-contract` flag ([http.md › Undeclared-error check](./http.md#undeclared-error-check)).

### Open questions
- Resolved: `--port`, `--host` and `--hmr` carry over ([#126](https://github.com/Laratypes/Laratype/issues/126)).

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
proposed: PR [#366](https://github.com/Laratypes/Laratype/pull/366) @ 7c1590c (E2 [#134](https://github.com/Laratypes/Laratype/issues/134), M2). `make:command` was merged with F2 [#161](https://github.com/Laratypes/Laratype/issues/161) in PR [#357](https://github.com/Laratypes/Laratype/pull/357); this PR adds its shared name and identifier check. Depends on H2 #105, H9 #123. The commands live under [`packages/sauf/src/commands/make`](https://github.com/Laratypes/Laratype/blob/7c1590c160e395943c5cd9e8bcd6b6027b08b814/packages/sauf/src/commands/make) and the stubs under [`packages/sauf/resources/templates`](https://github.com/Laratypes/Laratype/blob/7c1590c160e395943c5cd9e8bcd6b6027b08b814/packages/sauf/resources/templates).

### Public API
[`make/index.ts` @ 7c1590c](https://github.com/Laratypes/Laratype/blob/7c1590c160e395943c5cd9e8bcd6b6027b08b814/packages/sauf/src/commands/make/index.ts) registers every generator; each takes one or more names. The table lists the v1 generators; the kept 0.5 generators (`make:gate`, `make:middleware`, `make:model`, `make:policy`, `make:factory`, `make:seeder`) keep their 0.5 destinations and stubs until their area's issue (Non-goals), but every one of them except `make:factory` and `make:seeder` now checks its names (Invariants).

| Command | Writes | Stub |
|---|---|---|
| `sauf make:contract <names...>` | `app/api/<name>.ts`; a sub-path is kept (`users/posts` -> `app/api/users/posts.ts`) | `export default defineContract<Prefix>()({...})` with `import type { Prefix } from "./$types"` and an `index` GET endpoint whose query schema coerces its number |
| `sauf make:controller <names...>` | `app/http/controllers/<name>.ts` | a `Controller` subclass with an `index(_ctx: Ctx<AnyEndpoint>)` method; mount it with `r.contract()` and annotate each method `Ctx<typeof contract.endpoint>` ([http.md › Controller typing](./http.md#controller-typing-ctx-and-controllerof)) |
| `sauf make:request <names...>` | `app/http/requests/<name>.ts` | the 0.5 `Request` class with a zod `rules()` schema; FormRequest v2 is planned → [#137](https://github.com/Laratypes/Laratype/issues/137) |
| `sauf make:resource <names...> [-c, --collection]` | `app/http/resources/<name>Resource.ts`, and `<name>ResourceCollection.ts` with `--collection` | `defineResource` over a placeholder model class the author swaps for the app's model ([http.md › Resources](./http.md#resources)) |
| `sauf make:command <names...>` | `app/console/commands/<name>.ts`; a sub-path is flattened | `class <Name> extends Command<typeof <Name>.signature>` with the signature derived from the class name ([services.md › Console commands](./services.md#console-commands)) |

### Invariants
- **Destinations** are the v1 project layout ([overview.md › Project structure](./overview.md#project-structure)): contracts under `app/api` (the default `api.root`), controllers, requests and resources under `app/http/`, commands under `app/console/commands/`. Four kept 0.5 generators write their own folders under `src/`: `make:gate` `src/gates`, `make:middleware` `src/http/middleware`, `make:model` `src/models` and `make:policy` `src/policies`; the gate and policy stubs import `../models/User`, so a sub-path nests the file and breaks that import as it did before, and they are not type-checked. `make:factory` and `make:seeder` keep `database/factories` and `database/seeders`. An existing file is left untouched with a `[SKIPPED]` warning.
- **Generator names are checked before writing.** `make:contract`, `make:controller`, `make:request`, `make:resource`, `make:gate`, `make:middleware`, `make:model`, `make:policy` and `make:command` validate every name before the first file is written. The shared `generatorPath()` rejects an empty segment, `.`, `..`, a leading `/`, a `\` and any character outside `[A-Za-z0-9_-]`, and drops a trailing `.ts` (any case). `make:contract` normalizes a `\` separator instead and allows a `[param]` folder. A sub-path is kept as folders for all of them, except `make:command`, which flattens it to its file name; `make:command` also rejects a name another command file already uses (see Diagnostics). `make:factory` and `make:seeder` keep their 0.5 `getFileName()` behavior and ship with DB5 [#149](https://github.com/Laratypes/Laratype/issues/149).
- **The last segment names the exported class or function** for `make:controller`, `make:request`, `make:resource`, `make:gate`, `make:middleware`, `make:model`, `make:policy` and `make:command`, so it must be a TypeScript identifier (`[A-Za-z_][A-Za-z0-9_]*`, not starting with a digit); a reserved word (`class`, `const`, `await`, ...) cannot name a class in a module, so it is refused with the same diagnostic. A folder segment keeps `-` (`my-team/PostController` is valid, `my-note` is not). `make:contract` names no class and keeps its folder rules. `make:command` derives its signature from the file name, and a signature that registration would reject is refused before writing (see Diagnostics).
- **The folder tree names a contract.** `make:contract` writes no name or URL prefix: both come from the file's place in the tree ([contract.md › Contract folder tree](./contract.md#contract-folder-tree)). A sub-path is kept (`users/posts` -> `app/api/users/posts.ts`, and `[param]` folders are allowed); a trailing `.ts` and `\` path separators in the argument are normalized. A new folder gets its `$types.d.ts` when `sauf types:generate` (or `sauf dev`) next scans the tree; the scan reads file names only. A segment outside the tree's naming rules (`.`, `..`, an absolute path) is rejected by the generator, and so is an `index` with no named folder: a root `index` (any case, with or without `.ts`, which a lowercase `index.ts` would fail the scan on) and an index under only `[param]` folders, because neither has a contract name. A named folder's `index.ts` is allowed and names its folder (`users/index.ts` -> `/api/users`); a duplicate contract name fails that scan.
- **The stubs type-check** in `examples/basic`. The test generates into a temp copy of `examples/basic`; no generated file is committed to it.
- **Stub rules** (carried from C3 [#91](https://github.com/Laratypes/Laratype/issues/91) and S2 [#85](https://github.com/Laratypes/Laratype/issues/85); see [overview.md › Cross-cutting rules](./overview.md#cross-cutting-rules)):
  - stubs import `import * as z from "zod"`. `import { z } from "zod/v4"` grows the FE bundle from about 16 KiB to 47 KiB gzip;
  - on the repo's zod 3.25 `zod` entry, contract and request stubs write `z.coerce.number()`. With zod 4's default entry the input type of plain `z.coerce.number()` is `unknown`, so the stub then needs `z.coerce.number<number>()`;
  - `zod/v4-mini` (about 8.3 KiB) is the recommendation for FE bundles.
- **`make:request` stays 0.5** until FormRequest v2 ([#137](https://github.com/Laratypes/Laratype/issues/137)): the class extends `Request` and declares `rules()`. A contract route validates the contract's schemas and takes no request class ([validation.md › FormRequest v2](./validation.md#formrequest-v2)).
- **`make:resource` maps plain data:** `defineResource(model, fn)` returns `make`, `collection` and `paginate`; the contract checks the returned data at `r.contract()` ([http.md › Resources](./http.md#resources)). The placeholder model class in the stub is replaced by the app's model.
- **`make:command`** writes the v1 layout with `Command<typeof <Name>.signature>` and an empty `handle()`; the author edits the derived signature. It refuses a name that another file in `app/src/console/commands` or `app/console/commands` already uses, because the manifest reads both layouts and both `.ts`/`.mts` extensions.

### Diagnostics
- `[SKIPPED] The file <path> already exists.` (the generator leaves the file untouched).
- `Invalid contract name "<name>": use letters, digits, "_" and "-", or a [param] folder, under app/api.` (`make:contract`, for a segment that would leave the tree).
- `Invalid controller name "<name>": use letters, digits, "_" and "-", in folders under app/http/controllers.` (`make:controller`, for a segment that would leave its folder).
- `Invalid request name "<name>": use letters, digits, "_" and "-", in folders under app/http/requests.` (`make:request`, for a segment that would leave its folder).
- `Invalid resource name "<name>": use letters, digits, "_" and "-", in folders under app/http/resources.` (`make:resource`, for a segment that would leave its folder).
- `Invalid gate name "<name>": use letters, digits, "_" and "-", in folders under src/gates.` (`make:gate`, for a segment that would leave its folder).
- `Invalid middleware name "<name>": use letters, digits, "_" and "-", in folders under src/http/middleware.` (`make:middleware`, for a segment that would leave its folder).
- `Invalid model name "<name>": use letters, digits, "_" and "-", in folders under src/models.` (`make:model`, for a segment that would leave its folder; `make:policy -m` validates its model with the same rules, so both model messages name the model).
- `Invalid policy name "<name>": use letters, digits, "_" and "-", in folders under src/policies.` (`make:policy`, for a segment that would leave its folder).
- `Invalid command name "<name>": use letters, digits, "_" and "-", in folders under app/console/commands.` (`make:command`, for a file name outside those characters after the sub-path is flattened).
- `Invalid <generator> name "<name>": the last segment names the exported class or function, so use a valid identifier (letters, digits and "_", not starting with a digit), under <folder>.` (`make:controller`, `make:request`, `make:resource`, `make:gate`, `make:middleware`, `make:model`, `make:policy` and `make:command`, for a file name that is not a TypeScript identifier; a folder segment keeps `-`).
- `Invalid contract name "<name>": an index needs a named folder under app/api. Fix: name the file after its contract (users.ts), or use a named folder (users/index.ts).` (`make:contract`, for a root `index` in any case and with or without `.ts`, or an `index` under only `[param]` folders; a named folder's `index` is allowed).
- `Cannot create <path>: <existing path> already uses the command name "<name>", and the manifest reads both. Fix: rename or remove one.` (`make:command`, when the 0.5 layout or another `.ts`/`.mts` file already uses the name).
- `make:command` joins the derived words with one `:` and drops empty segments, so `_CleanCache`, `CleanCache_` and `Clean__Cache` all write `clean:cache`: a signature never starts or ends with `:` and never has `::`. A name whose derived signature registration would reject is refused before the stub is written: `make:command: "<name>" does not give a valid signature: Invalid command signature "<signature>": <reason>`.

### Example
```ts
// app/api/reports/monthly.ts, from `sauf make:contract reports/monthly`
import { defineContract, endpoint } from "@laratype/contract";
import * as z from "zod";
import type { Prefix } from "./$types";

const IndexQuery = z.object({ page: z.coerce.number().int().min(1).default(1) });

export default defineContract<Prefix>()({
  index: endpoint.get("/").query(IndexQuery),
});
```

### Non-goals
- The other 0.5 generators keep their 0.5 layout and stub until their area's issue: `make:middleware` with H6 [#117](https://github.com/Laratypes/Laratype/issues/117), `make:policy` and `make:gate` with A3 [#121](https://github.com/Laratypes/Laratype/issues/121), `make:model` with DB1 [#145](https://github.com/Laratypes/Laratype/issues/145), `make:factory` and `make:seeder` with DB5 [#149](https://github.com/Laratypes/Laratype/issues/149). The four listed first already validate their names (Invariants).
- The service generators ship with their area: `make:event` and `make:listener` with EV1 [#165](https://github.com/Laratypes/Laratype/issues/165), `make:job` with Q1 [#169](https://github.com/Laratypes/Laratype/issues/169), `make:mail` with ML1 [#170](https://github.com/Laratypes/Laratype/issues/170).
- No v1 request stub until [#137](https://github.com/Laratypes/Laratype/issues/137).

### Open questions
- Resolved: each remaining 0.5 generator's v1 layout and each service generator ship with its area's issue, listed above ([#134](https://github.com/Laratypes/Laratype/issues/134)).

### Acceptance
[#134 Done when](https://github.com/Laratypes/Laratype/issues/134)
