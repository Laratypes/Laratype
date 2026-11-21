---
area: typegen
packages: ["sauf", "@laratype/ts-gen"]
issues: [85, 133, 142, 143, 144, 259]
verified-against: Laratype@d70daa7 (+ 256a743 and v0.5.4 @ 053be38 for the 0.5 state)
last-verified: 2026-10-13
---

# Typegen

> `sauf types:generate` is merged ([#133](https://github.com/Laratypes/Laratype/issues/133)); the watch is proposed ([#142](https://github.com/Laratypes/Laratype/issues/142)); the other sections are planned. On `v0.5.4`, `packages/ts-gen` contains only `package.json`, so there was no 0.5 generator to port. [#133](https://github.com/Laratypes/Laratype/issues/133) records why the earlier oxc AST approach was dropped: oxc has no type checker, so it cannot infer handler return types. Decision record: S2 [#85](https://github.com/Laratypes/Laratype/issues/85), [DECISIONS-S1-S2.md §S2](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/DECISIONS-S1-S2.md#s2-85-decision). The prototype generator is `spikes/v1/s2-api/scripts/gen.mjs` on PR #197 @ 4c558fd.

| Section | Status |
|---|---|
| [sauf types:generate](#sauf-typesgenerate) | merged ([#133](https://github.com/Laratypes/Laratype/issues/133)); config key `api.root` / `api.base` merged ([#104](https://github.com/Laratypes/Laratype/issues/104)); `{ scope, dir }` entries and the walk by brand proposed: PR [#310](https://github.com/Laratypes/Laratype/pull/310) @ cb9a5fe |
| [Watch mode in sauf dev](#watch-mode-in-sauf-dev) | proposed: PR [#397](https://github.com/Laratypes/Laratype/pull/397) @ 23b5baa9 (G2 [#142](https://github.com/Laratypes/Laratype/issues/142)) |
| [OpenAPI](#openapi) | planned → #143 |
| [Detective](#detective) | planned → #144 |

---

## sauf types:generate

### Status
merged ([#133](https://github.com/Laratypes/Laratype/issues/133)). The config key `api.root` / `api.base` is merged ([#104](https://github.com/Laratypes/Laratype/issues/104)). The manifest fields (success status, body flag, error statuses) are proposed: PR [#402](https://github.com/Laratypes/Laratype/pull/402) @ 34876682 (CL8 [#259](https://github.com/Laratypes/Laratype/issues/259)). Running it as step 4 of `sauf build` is part of the planned [build steps](./build.md#sauf-build-steps), and the watch in `sauf dev` is proposed: PR [#397](https://github.com/Laratypes/Laratype/pull/397) @ 23b5baa9 ([#142](https://github.com/Laratypes/Laratype/issues/142)).

### Public API
[`packages/sauf/src/commands/types/generate.ts`](../../packages/sauf/src/commands/types/generate.ts) · [`packages/sauf/src/typegen/`](../../packages/sauf/src/typegen/)

```
sauf types:generate [--root <config api.root, else app/api>] [--base <config api.base, else /api>] [--out .laratype] [--api-out <out>/api.ts] [--tsconfig tsconfig.json]
```

```ts
// packages/sauf/src/typegen (used by the command; also exported for tests and G2)
export interface GenerateOptions { projectDir: string; root?: string; base?: string; outDir?: string; apiOut?: string; tsconfig?: string }
export function generateTypes(options: GenerateOptions, ts?: typeof import("typescript")): Promise<{ tree: ContractTree; files: GeneratedFile[] }>;
export function syncContractTree(options: GenerateOptions): { tree: ContractTree; files: GeneratedFile[]; changed: string[] } | undefined;   // the dev scan: no TS checker, no api.ts, writes changed files only (H1 #104)
export function readApiTreeConfig(projectDir: string): Promise<{ root?: string; base?: string }>;                         // config api.root / api.base
export function resolveApiTree(flags, config): { root: string; base: string };                                           // flags, then config, then defaults
export function laratypeApi(options?: { projectDir?: string; outDir?: string; config?: () => unknown }): Plugin<ApiPluginApi>;   // resolves $api, scans on the first import
// ApiPluginApi: rescan(), refresh(), restart() (the last two rescan when $api was imported before), inTree(file), isGenerated(file), affectsTree(event, file): used by sauf dev's type watch and --hmr restarts
export function scanFiles(files: readonly string[], base: string): ContractTree;   // names only, never contents
export function scanTree(rootDir: string, base: string): ContractTree;
export function isTreeFile(file: string): boolean;
export function emitTree(tree: ContractTree, options: { root: string; outDir: string }): GeneratedFile[];
export function generateApiFile(ts: typeof import("typescript"), options: ApiFileOptions): GeneratedFile & { manifest: Record<string, ManifestEntry> };
export function loadTypeScript(): Promise<typeof import("typescript")>;
export class ScanError extends Error {}
export class ApiGenerationError extends Error {}
export class TypeScriptMissingError extends Error {}
```

Output, for the default options:

| File | Content |
|---|---|
| `.laratype/types/<root>/<folder>/$types.d.ts` | `Prefix` and `ScopePrefix` for one folder of the tree ([contract.md › Contract folder tree](./contract.md#contract-folder-tree)) |
| `.laratype/api/index.gen.ts` | `export const appApi = defineApi({ 'users.posts': { contract, path, scopes: [{ scope, dir }] }, ... })` and `export type AppApi = typeof appApi`, imported as `$api` |
| `.laratype/api.ts` | the separate-repo file: `export type AppApi = {...}` (flattened `ApiTypes<AppApi>`) and `export const manifest = {...} as const`, with each route's method, full path, success status, body flag and error statuses |

The app's tsconfig needs:
```jsonc
{
  "compilerOptions": {
    "rootDirs": [".", ".laratype/types"],                    // ./$types resolves next to each contract file
    "paths": { "$api": ["./.laratype/api/index.gen.ts"] }
  },
  "include": ["app", ".laratype"]
}
```

### Invariants
- **Scan:** the tree is read from file and folder names only, never from file contents ([contract.md › Contract folder tree](./contract.md#contract-folder-tree) has the rules).
- **Options:** the root and base come from config `api.root` / `api.base` (`app/config/config.ts`), and `--root` / `--base` override them; the defaults are `app/api` → `/api` (merged, [#104](https://github.com/Laratypes/Laratype/issues/104)). The command does not load the app (`static bootsApp = false`: no `register()`, so no `$api` import or dev scan) and boots no provider, so it needs no database or auth env. It loads the project `.env`, then imports `app/config/config.ts` in isolation (jiti, no module cache). With both `--root` and `--base` given it does not import the config at all. When the file itself can't be imported on its own (a Vite or tsconfig path alias, a module that needs Vite transforms, a `$api` import), the command warns and goes on with the flags and the defaults, as it did before the config key; an `api` key that loads but is invalid still fails. The dev scan behind `$api` fails on both. `--out` is a flag only (default `.laratype`).
- **Generated folder:** `.laratype/` is generated and belongs in `.gitignore`. `--out` must be a folder inside the project that doesn't contain the tree root. The root may be the project itself (`--root .` or `api.root: '.'`); the output folder is then inside the root, and the scan and the dev watcher skip it. Each run rewrites its own files, deletes the `$types.d.ts` of a deleted folder and prunes the folders left empty. Other files under `--out` are never deleted. Before any write or stale-file delete, each run checks every existing folder from the project down to the `types` folder (each segment of a multi-segment `--out` included) and every generated target: a folder or generated file that is itself a junction or symlink is refused with one diagnostic, even when it points inside the project, so a linked `.laratype` / `.laratype/types` can never make the writer or the stale-file delete touch its target. The output folder's realpath and the nearest existing parent of every target must also stay inside the project; a link that leaves it is refused with one diagnostic, and nothing is written or deleted.
- **`index.gen.ts`:** one entry per contract, sorted by tree name. Its imports are relative and extension-less.
- **Strict mode:** the contract types need `strictNullChecks` (`"strict": true`), so the command refuses a project tsconfig without it.
- **`api.ts` uses the TS checker only.** It type-checks `index.gen.ts` through the project tsconfig, with `<out>/types` added to `rootDirs`, and prints `ApiTypes<AppApi>`. It tells endpoints from nodes by type, as `ApiTypes` does (`AnyEndpoint`), not by a `method` field, so an endpoint key such as `method` stays an endpoint; an `AppApi` without the `API_ROOT` brand fails ([#258](https://github.com/Laratypes/Laratype/issues/258)). No contract module is executed. A type error in the tree fails the command.
- **`api.ts` is self-contained:** it has no import, no contract library and no schema library. Named types are inlined structurally, for example a user interface or the contract's `MessageBody`. Types from the TypeScript default lib keep their names (`Date`, `Record<string, boolean>`). A type met again while it is being printed (a recursive type) prints `unknown`. Optional members print as `x?: T | undefined`.
- **Manifest:** a flat map keyed by route name, `'users.posts.update': { method, path, status, response, errors }`. `path` is the full path; `status` is the endpoint's success status (omitted only for a wide `number` status type, which the builder never produces); `response` is `true` when the success carries a JSON body (a response schema and a status other than 204/205); `errors` holds `{ status, code }` for each derived and declared error, sorted by code and then status, with exact duplicates removed (the same code at two statuses stays as two entries). `createClient<AppApi>(manifest)` types and validates it for the client, merged ([#109](https://github.com/Laratypes/Laratype/issues/109)); see [client.md › Separate-repo FE](./client.md#separate-repo-fe-generated-manifest) and [client.md › Result union](./client.md#result-union) for the rules the fields trigger. A manifest generated before CL8 has `errors` as code strings only, no `status` and no `response`; the client still accepts it with its old lenient behaviour. A wide `number` status type (defensive: the builder's generics produce literals) keeps the code-string form, which matches any 4xx/5xx; a wide `string` code names no code to match and is left out.
- **Generated types** are a `type` alias. They satisfy the client's `ApiShape<A>` self-constraint, and they are mutually assignable with `ApiTypes<AppApi>` (tested).
- **`typescript` is an optional peer dependency** of `sauf` (`>=5`). It is loaded with a dynamic `import()` in `types:generate` only, so `sauf dev` and the app never load it.

### Diagnostics
Errors are printed by the command, which exits with code 1, prefixed `[sauf types:generate] `. The scan and config errors (`ScanError`) carry no prefix of their own, so the dev scan behind `$api` prints the same messages prefixed `[laratype:api] `. Names in these messages (file, folder, stem, route, base and output path) are `JSON.stringify`-quoted, so a control character or ANSI escape prints as `\uXXXX`, never raw:
- `the contract tree root "<root>" does not exist (set it with --root or config api.root)`
- `the output folder "<dir>" (--out, or the dev plugin's outDir) must be a folder inside the project, not the project itself or outside it`
- `the output folder "<dir>" must not contain the contract tree root "<root>" (--root or config api.root)`
- `the output path "<path>" resolves outside the project ("<real>"): a junction or symlink under the output folder must stay inside it` (the `("<real>")` part is absent for a broken link; the write or stale-file delete is refused and nothing outside the project is touched)
- `the output path "<path>" is a symbolic link or junction; refusing to write through it` (the path is an output folder or a generated file, refused even when the link points inside the project, before anything is written or deleted)
- `the contract tree root "<root>" (--root | config api.root) must be a folder inside the project` (one rule for the flag and the config: the root must be a relative path, so absolute paths, drive letters included, are rejected even when they point inside the project, and so is `..` leading outside; `.`, the project itself, is accepted)
- `base "<base>"` / `config api.base` ` must be "" or a path that starts with "/" and does not end with "/", such as "/api"` (one rule for the scan and the config)
- `"<file>" and "<file>" are the same contract ("<path>"): keep one` (`users.ts` and `users/index.ts`)
- `"<file>" and "<file>" have the same name "<name>" ([x] folders are dropped from names)`
- `"<file>": a contract needs a name; put it in a named folder (the root index.ts has none)`
- `"<dir>": "<folder>" is not a valid param folder: use [name]; optional and rest param folders are not supported`
- `"<dir>": folder name "<name>" may only use letters, digits, "_" and "-"`
- `"<file>": file name "<stem>" may only use letters, digits, "_" and "-" (use a [x] folder for params)`
- `config api must be { root?, base? }`, `config api.root must be a folder, relative to the project`, `config api.base must be "" or a path that starts with "/" and does not end with "/", such as "/api"`, `could not load app/config/config.ts (see the error above)`, `app/config/config.ts could not be imported on its own (no Vite or tsconfig path aliases there): <error>` (the config, or a module it imports, failed to import, for example through a path alias). For these import failures (and `must not import $api`), `sauf types:generate` prints a warning instead, `[sauf types:generate] <message>; using --root / --base and the defaults (app/api, /api) instead of config api`, and goes on
- `the contract types need strictNullChecks: set "strict": true in <tsconfig>`
- `the contract tree does not type-check:` followed by the tsc diagnostics
- `AppApi in <index file> must be the type of the appApi from defineApi`
- `sauf types:generate needs the typescript package (>=5): add it to the project's devDependencies`

### Example
[`packages/sauf/__tests__/typegen/`](../../packages/sauf/__tests__/typegen/):
- `fixtures/project` is a tree;
- `__snapshots__/` holds its generated files;
- `fixtures/fe` is a separate FE compiled against `api.ts` only.

### Non-goals
- No OpenAPI (G3 [#143](https://github.com/Laratypes/Laratype/issues/143)). The watch lives in `sauf dev` ([Watch mode in sauf dev](#watch-mode-in-sauf-dev)); this command reads the tree once.
- No server code: the dev scan behind `$api` (`syncContractTree`, the `laratype:api` plugin) reuses this scan and emit without the TS checker ([http.md › Router v2](./http.md#router-v2)).

### Open questions
- Resolved: the earlier `laratype-api.d.ts` + `rollup-plugin-dts` task is superseded by S2 ([#133](https://github.com/Laratypes/Laratype/issues/133)).

### Acceptance
[#133 Done when](https://github.com/Laratypes/Laratype/issues/133) · [#259 Done when](https://github.com/Laratypes/Laratype/issues/259)

---

## Watch mode in sauf dev

### Status
proposed: PR [#397](https://github.com/Laratypes/Laratype/pull/397) @ 23b5baa9 (G2 [#142](https://github.com/Laratypes/Laratype/issues/142), v1 · M2 — v1-alpha).

### Public API
[`packages/sauf/src/typegen/watch.ts`](https://github.com/Laratypes/Laratype/blob/23b5baa9a6fb4cee96d4e29ba71682512a881d75/packages/sauf/src/typegen/watch.ts) · [`plugin.ts`](https://github.com/Laratypes/Laratype/blob/23b5baa9a6fb4cee96d4e29ba71682512a881d75/packages/sauf/src/typegen/plugin.ts) · [`commands/dev.ts`](https://github.com/Laratypes/Laratype/blob/23b5baa9a6fb4cee96d4e29ba71682512a881d75/packages/sauf/src/commands/dev.ts)

```ts
// ApiPluginApi (laratype:api), used by sauf dev
refresh(): Promise<void>;                                  // rescans when the app has imported $api before; no-op otherwise

export interface WatchEvents {                             // Vite's server.watcher in sauf dev
  on(event: "add" | "change" | "unlink", listener: (file: string) => void): unknown;
  off(event: "add" | "change" | "unlink", listener: (file: string) => void): unknown;
}
export interface ContractTypeWatchOptions {
  readonly events: WatchEvents;
  readonly tree: Pick<ApiPluginApi, "affectsTree" | "isGenerated" | "refresh">;
  readonly delay?: number;                                 // debounce, default 30 ms; finite, 0 or more
  readonly onError?: (error: unknown) => void;             // default console.error
}
export class ContractTypeWatch {
  constructor(options: ContractTypeWatchOptions);          // throws a TypeError on a bad option
  idle(): Promise<void>;                                   // no debounce or scan pending
  dispose(): void;
}
export class ContractTypeWatchHost {                       // one live watch for one app instance
  get active(): boolean;
  open(options: ContractTypeWatchOptions): ContractTypeWatch;   // disposes the previous watch
  close(): void;
  idle(): Promise<void>;
}
```

### Invariants
- **Always on.** `sauf dev` opens the watch on the first boot and on every `--hmr` restart (`appStart`); `--hmr` is not required. Vite's `server.watcher` (chokidar, already a Vite dependency) is the only watcher: no `package.json` or lockfile change.
- **Triggers.** An `add` or `unlink` of a contract or `_scope.ts` under the contract root, and a `change`, `add` or `unlink` of `app/config/config.ts` (the `api.root` / `api.base` source). A rename is `unlink` + `add`. `affectsTree()` is the shared rule, and the watch drops an `isGenerated()` path first. An event outside the tree, on the generated output, or on a private/test file is ignored.
- **A content edit needs no regeneration: the generated files import the contract file.** The scan reads names only; `index.gen.ts` imports every contract and `$types.d.ts` imports its scope files. An FE program that imports `$api` (or a contract file) therefore sees an edited body or response schema immediately, with no scan and no write. The content-edit test type-checks the same FE program before and after editing `app/api/users.ts`, asserts the type changes, and asserts zero scans and unchanged generated files.
- **Coalescing.** A 30 ms debounce after the last relevant event, then one `refresh()`. `laratype:api` serializes scans (`coalesce`): a call during a scan queues exactly one follow-up, and two generations never overlap. A burst of 1,000 events runs one generation. `idle()` resolves when the debounce and the scan are done, so tests await it instead of sleeping.
- **H1 gate.** Like `restart()`, `refresh()` rescans only after the app has imported `$api`: an app that never imports it is never scanned, so a 0.5 app with helpers in `app/api` still boots. The first `$api` import is the first scan.
- **Incremental output.** Each generation rescans the whole tree by names (no TS checker, no `api.ts`) and writes only the files whose content changed: `$types.d.ts` per folder and `api/index.gen.ts`. `removeStaleTypes()` deletes the `$types.d.ts` of a deleted folder and prunes the folders left empty; no other file under `.laratype/` is deleted, and nothing outside it is ever touched. The same output guard as `sauf types:generate` refuses a junction or symlink under `.laratype/` that leaves the project, and a linked `.laratype` / `.laratype/types` or generated file even when it points inside: one diagnostic, and nothing is written or deleted. A changed `api.root` / `api.base` moves the output on the next event.
- **Lifecycle.** `ContractTypeWatchHost` keeps one live watch: `open()` disposes the previous one on the first boot and on every `--hmr` restart, and the `laratype:dev-server` plugin's `closeBundle()` closes it when the Vite server closes, so listeners and timers never stack. A scan already in flight finishes (the plugin serializes it).
- **Deleted root.** Deleting the whole contract root keeps the last good output and the dev server keeps running; recreating the tree regenerates on the next event. Importing `$api` while the root is gone still fails with the existing `[laratype:api] ... does not exist` error.
- **Server.** The watch writes the type files only; it does not rebuild the running app. Routes are mounted at boot from `appApi`, so a new or removed route still needs a `--hmr` restart (Non-goals).

### Diagnostics
- A refresh that ends in a failed scan is reported once, prefixed `[laratype:api]`, through `Console.error`. The scan and emit run before any write, so the last good output stays and the dev server keeps running; the next relevant event retries. The messages are the ones in [sauf types:generate › Diagnostics](#diagnostics), for example `[laratype:api] "bad.name.ts": file name "bad.name" may only use letters, digits, "_" and "-" (use a [x] folder for params)`.
- A junction or symlink under `.laratype/` is the same one-shot error, before any write or delete: a linked output folder (`.laratype`, `.laratype/types`, a segment of a multi-segment `--out`) or a generated file that is itself a link is refused even when the link points inside the project, `[laratype:api] the output path ".laratype/types" is a symbolic link or junction; refusing to write through it`. The realpath check stays as the last containment guard, with the `the output path "<path>" resolves outside the project ("<real>")` message from [sauf types:generate › Diagnostics](#diagnostics), and nothing outside is touched.
- A syntax or type error in a contract is not a dev-scan error (the scan never reads contents): it surfaces in the FE's TypeScript tooling and, with `--hmr`, in the app restart.
- A `TypeError` from the watcher's options names the option: `the type watch needs an options object`, `the type watch events must provide on() and off()`, `the type watch tree needs affectsTree(), isGenerated() and refresh()`, `the type watch onError must be a function`, `the type watch delay must be a finite number of milliseconds, 0 or more, got <value>`.

### Example
[`packages/sauf/__tests__/typegen/watch.test.ts`](../../packages/sauf/__tests__/typegen/watch.test.ts) works on a temp copy of the typegen fixture:
- add: a new folder gets its `$types.d.ts` and an `index.gen.ts` entry;
- rename and delete: the index follows, and the deleted folder's `$types.d.ts` is removed;
- a config change to `api.root` / `api.base` moves the generated files;
- a bad file name logs the scan error, keeps the last output, and the next save recovers;
- a content edit: the FE program's type changes, with zero scans;
- a 1,000-event burst: one scan; events during a scan: one follow-up, no overlap;
- a symlink/junction out of the tree, a path outside the tree, unicode/control/long names, a whole-tree delete, `dispose()`, and a real Vite `server.watcher` add/change/unlink plus server close;
- a junction/symlink under `.laratype` that leaves the project (a folder inside the output and the output folder itself): one diagnostic, the last output intact, and nothing written outside;
- `.laratype`, `.laratype/types` and a multi-segment `--out` segment as links to a folder inside the project, and a `$types.d.ts` that is itself a file symlink to `package.json`: refused before any write or delete, the link's target and the last output untouched, and a normal regenerate is a no-op again once the links are removed;
- the dev wiring, as a proposed example: [`docs/v1/examples/typegen/proposed/watch.ts`](./examples/typegen/proposed/watch.ts).

### Non-goals
- **No server route reload without a restart.** The running Hono app builds its route registry at boot; Vite SSR module invalidation alone does not rebuild it. `--hmr` restarts stay the way the server picks up added or removed routes, and an edited contract still needs one to change a running route. This is a follow-up (Open questions), not part of #142's Done-when, which is about FE types.
- No `api.ts` in dev: the watch writes `$types.d.ts` and `index.gen.ts`; the separate-repo FE file stays `sauf types:generate`'s output.
- No unconditional scan at start (H1 gate above), no watch outside the contract root and the config file, and no new dependency.

### Open questions
- None.

### Acceptance
[#142 Done when](https://github.com/Laratypes/Laratype/issues/142)

---

## OpenAPI

### Status
planned → [#143](https://github.com/Laratypes/Laratype/issues/143) (G3, M3).

### Design (non-binding)
- **Generation:** `openapi.json` comes from the route registry (H1 [#104](https://github.com/Laratypes/Laratype/issues/104)), with each schema converted to JSON Schema. Done when it passes `redocly lint`.
- **Exclusions:** ad-hoc routes without a contract are excluded ([#139](https://github.com/Laratypes/Laratype/issues/139)).
- **Errors and security:** each operation's error responses are the endpoint's derived errors, and `auth` maps to the operation's security requirement ([contract.md › Capabilities and derived errors](./contract.md#capabilities-and-derived-errors)).

### Acceptance
[#143 Done when](https://github.com/Laratypes/Laratype/issues/143)

---

## Detective

### Status
planned → [#144](https://github.com/Laratypes/Laratype/issues/144) (G4, M3).

### Design (non-binding)
- **Data:** the Detective devtools UI consumes `openapi.json` and the route registry, so controller, middleware and schemas are visible.
- **Manifest fix:** #144 reports that `BuildRoute.normalize()` uses `constructor.name` of an array, so the controller shows as `null` in `.laratype/app-manifest.json`, and G4 fixes this. Neither `BuildRoute`, that manifest nor the Detective UI is in this repo on master (`256a743`) or on `v0.5.4`.

### Open questions
- Where the Detective source and `BuildRoute` live → [#144](https://github.com/Laratypes/Laratype/issues/144)

### Acceptance
[#144 Done when](https://github.com/Laratypes/Laratype/issues/144)
