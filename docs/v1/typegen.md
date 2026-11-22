---
area: typegen
packages: ["sauf", "@laratype/ts-gen"]
issues: [85, 133, 142, 143, 144]
verified-against: Laratype@d70daa7 (+ 256a743 and v0.5.4 @ 053be38 for the 0.5 state)
last-verified: 2026-10-13
---

# Typegen

> `sauf types:generate` is merged ([#133](https://github.com/Laratypes/Laratype/issues/133)); the watch is merged ([#142](https://github.com/Laratypes/Laratype/issues/142)); the other sections are planned or proposed. On `v0.5.4`, `packages/ts-gen` contains only `package.json`, so there was no 0.5 generator to port. [#133](https://github.com/Laratypes/Laratype/issues/133) records why the earlier oxc AST approach was dropped: oxc has no type checker, so it cannot infer handler return types. Decision record: S2 [#85](https://github.com/Laratypes/Laratype/issues/85), [DECISIONS-S1-S2.md §S2](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/DECISIONS-S1-S2.md#s2-85-decision). The prototype generator is `spikes/v1/s2-api/scripts/gen.mjs` on PR #197 @ 4c558fd.

| Section | Status |
|---|---|
| [sauf types:generate](#sauf-typesgenerate) | merged ([#133](https://github.com/Laratypes/Laratype/issues/133)); config key `api.root` / `api.base` merged ([#104](https://github.com/Laratypes/Laratype/issues/104)); `{ scope, dir }` entries and the walk by brand proposed: PR [#310](https://github.com/Laratypes/Laratype/pull/310) @ cb9a5fe; hard-link guard proposed: PR [#399](https://github.com/Laratypes/Laratype/pull/399) @ 9ca3d3b5 |
| [Watch mode in sauf dev](#watch-mode-in-sauf-dev) | merged @ 8ad92ae9 (G2 [#142](https://github.com/Laratypes/Laratype/issues/142)); hard-link guard proposed: PR [#399](https://github.com/Laratypes/Laratype/pull/399) @ 9ca3d3b5 |
| [OpenAPI](#openapi) | proposed: PR [#399](https://github.com/Laratypes/Laratype/pull/399) @ 9ca3d3b5 ([#143](https://github.com/Laratypes/Laratype/issues/143)) |
| [Detective](#detective) | planned → #144 |

---

## sauf types:generate

### Status
merged ([#133](https://github.com/Laratypes/Laratype/issues/133)). The config key `api.root` / `api.base` is merged ([#104](https://github.com/Laratypes/Laratype/issues/104)). Running it as step 4 of `sauf build` is part of the planned [build steps](./build.md#sauf-build-steps), and the watch in `sauf dev` is merged: 8ad92ae9 ([#142](https://github.com/Laratypes/Laratype/issues/142)). The generated-file hard-link guard is proposed in PR [#399](https://github.com/Laratypes/Laratype/pull/399) @ 9ca3d3b5.

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
| `.laratype/api.ts` | the separate-repo file: `export type AppApi = {...}` (flattened `ApiTypes<AppApi>`) and `export const manifest = {...} as const` |

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
- **Generated folder:** `.laratype/` is generated and belongs in `.gitignore`. `--out` must be a folder inside the project that doesn't contain the tree root. The root may be the project itself (`--root .` or `api.root: '.'`); the output folder is then inside the root, and the scan and the dev watcher skip it. Each run rewrites its own files, deletes the `$types.d.ts` of a deleted folder and prunes the folders left empty. Other files under `--out` are never deleted. Before any write or stale-file delete, each run checks every existing folder from the project down to the `types` folder (each segment of a multi-segment `--out` included) and every generated target: a folder or generated file that is itself a junction or symlink is refused with one diagnostic, even when it points inside the project, so a linked `.laratype` / `.laratype/types` can never make the writer or the stale-file delete touch its target. A generated file that already has another hard link is refused when this run would write it, with one diagnostic: writing through it would replace the other name's content. An unchanged file is a no-op, so a hard link on identical content does not fail a dev refresh. The output folder's realpath and the nearest existing parent of every target must also stay inside the project; a link that leaves it is refused with one diagnostic, and nothing is written or deleted.
- **`index.gen.ts`:** one entry per contract, sorted by tree name. Its imports are relative and extension-less.
- **Strict mode:** the contract types need `strictNullChecks` (`"strict": true`), so the command refuses a project tsconfig without it.
- **`api.ts` uses the TS checker only.** It type-checks `index.gen.ts` through the project tsconfig, with `<out>/types` added to `rootDirs`, and prints `ApiTypes<AppApi>`. It tells endpoints from nodes by type, as `ApiTypes` does (`AnyEndpoint`), not by a `method` field, so an endpoint key such as `method` stays an endpoint; an `AppApi` without the `API_ROOT` brand fails ([#258](https://github.com/Laratypes/Laratype/issues/258)). No contract module is executed. A type error in the tree fails the command.
- **`api.ts` is self-contained:** it has no import, no contract library and no schema library. Named types are inlined structurally, for example a user interface or the contract's `MessageBody`. Types from the TypeScript default lib keep their names (`Date`, `Record<string, boolean>`). A type met again while it is being printed (a recursive type) prints `unknown`. Optional members print as `x?: T | undefined`.
- **Manifest:** a flat map keyed by route name, `'users.posts.update': { method, path, errors }`. `path` is the full path, and `errors` is the endpoint's derived and declared error codes, sorted. `createClient<AppApi>(manifest)` types it for the client, merged ([#109](https://github.com/Laratypes/Laratype/issues/109)); see [client.md › Separate-repo FE](./client.md#separate-repo-fe-generated-manifest).
- **Generated types** are a `type` alias. They satisfy the client's `ApiShape<A>` self-constraint, and they are mutually assignable with `ApiTypes<AppApi>` (tested).
- **`typescript` is an optional peer dependency** of `sauf` (`>=5`). It is loaded with a dynamic `import()` in `types:generate` only, so `sauf dev` and the app never load it.

### Diagnostics
Errors are printed by the command, which exits with code 1, prefixed `[sauf types:generate] `. The scan and config errors (`ScanError`) carry no prefix of their own, so the dev scan behind `$api` prints the same messages prefixed `[laratype:api] `. Names in these messages (file, folder, stem, route, base and output path) are `JSON.stringify`-quoted, so a control character or ANSI escape prints as `\uXXXX`, never raw:
- `the contract tree root "<root>" does not exist (set it with --root or config api.root)`
- `the output folder "<dir>" (--out, or the dev plugin's outDir) must be a folder inside the project, not the project itself or outside it`
- `the output folder "<dir>" must not contain the contract tree root "<root>" (--root or config api.root)`
- `the output path "<path>" resolves outside the project ("<real>"): a junction or symlink under the output folder must stay inside it` (the `("<real>")` part is absent for a broken link; the write or stale-file delete is refused and nothing outside the project is touched)
- `the output path "<path>" is a symbolic link or junction; refusing to write through it` (the path is an output folder or a generated file, refused even when the link points inside the project, before anything is written or deleted)
- `the output path "<path>" has more than one hard link; refusing to overwrite it` (a generated file with another hard link that this run would change; refused before that write or stale-file delete, and the other name's content is untouched. An unchanged file is a no-op)
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
[#133 Done when](https://github.com/Laratypes/Laratype/issues/133)

---

## Watch mode in sauf dev

### Status
merged @ 8ad92ae9 (G2 [#142](https://github.com/Laratypes/Laratype/issues/142), v1 · M2 — v1-alpha); the generated-file hard-link guard is proposed in PR [#399](https://github.com/Laratypes/Laratype/pull/399) @ 9ca3d3b5.

### Public API
[`packages/sauf/src/typegen/watch.ts`](https://github.com/Laratypes/Laratype/blob/8ad92ae9d7b82975b7b6209268f6941da99e9d74/packages/sauf/src/typegen/watch.ts) · [`plugin.ts`](https://github.com/Laratypes/Laratype/blob/8ad92ae9d7b82975b7b6209268f6941da99e9d74/packages/sauf/src/typegen/plugin.ts) · [`commands/dev.ts`](https://github.com/Laratypes/Laratype/blob/8ad92ae9d7b82975b7b6209268f6941da99e9d74/packages/sauf/src/commands/dev.ts)

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
- A junction or symlink under `.laratype/` is the same one-shot error, before any write or delete: a linked output folder (`.laratype`, `.laratype/types`, a segment of a multi-segment `--out`) or a generated file that is itself a link is refused even when the link points inside the project, `[laratype:api] the output path ".laratype/types" is a symbolic link or junction; refusing to write through it`. A generated file with another hard link is refused the same way when a write is needed, with `[laratype:api] the output path ".laratype/api/index.gen.ts" has more than one hard link; refusing to overwrite it`, leaving both names unchanged; an unchanged hard-linked file is a no-op. The realpath check stays as the last containment guard, with the `the output path "<path>" resolves outside the project ("<real>")` message from [sauf types:generate › Diagnostics](#diagnostics), and nothing outside is touched.
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
- the dev wiring, as an example: [`docs/v1/examples/typegen/watch.ts`](./examples/typegen/watch.ts).

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
proposed: PR [#399](https://github.com/Laratypes/Laratype/pull/399) @ 9ca3d3b5 ([#143](https://github.com/Laratypes/Laratype/issues/143), G3, M2). It is generated from the contract `appApi` that `defineApi` builds (`.laratype/api/index.gen.ts`), not from the runtime `RouteRegistry`: the registry exists only after a booted app's `RouteAppServiceProvider` ([http.md › Router v2](./http.md#router-v2)), while `Route.api()` resolves the same tree with `apiRoutes(appApi)`, and every contract of the tree is mounted exactly once (a compile and runtime check of `Route.api`). Ad-hoc routes are not in the tree, so they are excluded ([#139](https://github.com/Laratypes/Laratype/issues/139)).

### Public API
[`packages/sauf/src/openapi/` @ 9ca3d3b5](https://github.com/Laratypes/Laratype/blob/9ca3d3b55e7cac866745478b49eb08d25dee722e/packages/sauf/src/openapi) · [`packages/sauf/src/commands/openapi/generate.ts` @ 9ca3d3b5](https://github.com/Laratypes/Laratype/blob/9ca3d3b55e7cac866745478b49eb08d25dee722e/packages/sauf/src/commands/openapi/generate.ts)

```
sauf openapi:generate [--root <dir>] [--base <path>] [--gen .laratype] [--out openapi.json]
```

```ts
// packages/sauf/src/openapi (the public entry point; `document.ts`, `schema.ts` and `load.ts` are the modules behind it)
export interface OpenApiContract {                  // the project's own @laratype/contract (see Invariants)
  readonly apiRoutes: (api: Api) => ReadonlyArray<ApiRoute>;   // Api and ApiRoute are type-only imports from the contract
  readonly isApiRoot: (value: unknown) => value is Api;
}
export interface OpenApiOptions {
  readonly contract: OpenApiContract;
  readonly title?: string;                          // info.title; default "Laratype API"
  readonly version?: string;                        // info.version; default "0.0.0"
}
export interface GeneratedOpenApi { readonly document: OpenApiDocument; readonly warnings: readonly string[] }
export function generateOpenApiDocument(api: unknown, options: OpenApiOptions): GeneratedOpenApi;   // pure, no Node import

export interface OpenApiFlags { readonly root?: string; readonly base?: string; readonly gen?: string; readonly out?: string }
export interface OpenApiProjectOptions extends OpenApiFlags {
  readonly projectDir: string;
  readonly load?: LoadFunction;                     // jiti (isolatedImport) by default
  readonly contract?: OpenApiContract;              // skip the project load for a caller that already has it
}
export type LoadFunction = (url: string) => Promise<unknown>;
export interface GeneratedOpenApiFile extends GeneratedOpenApi { readonly file: string; readonly changed: boolean }
export async function generateOpenApiFile(options: OpenApiProjectOptions): Promise<GeneratedOpenApiFile>;
export function errorReason(error: unknown): string;   // a safe one-line message for an import/write error
export class OpenApiGenerationError extends Error {}

export interface OpenApiDocument { readonly openapi: "3.1.0"; readonly info: { title: string; version: string };
  readonly servers: ReadonlyArray<{ url: string }>; readonly paths: Record<string, OpenApiPathItem>; readonly components: OpenApiComponents }
// and OpenApiOperation, OpenApiParameter, OpenApiRequestBody, OpenApiResponse, OpenApiPathItem, OpenApiComponents,
// OpenApiSecurityScheme, JsonSchema, JsonSchemaIo and JsonSchemaResult

// internal to sauf (the tests import the modules directly), not exported from openapi/index.ts:
// document.ts: the mapping above; schema.ts: standardJsonSchema, hasLocalRefs, hasBaseDependentRefs, rebaseRefs,
// isParentRef, isSchemaResource, oneLine and pointerSegment; load.ts keeps the project load, the package metadata and
// the writer private.
```

### Invariants
- **Source.** `appApi` from `<gen>/api/index.gen.ts`, the module `sauf types:generate` writes. The command runs the same scan first (`syncContractTree`: `$types.d.ts` and `index.gen.ts`, no TS checker and no `api.ts`), then imports the index and checks `isApiRoot`. `--root`, `--base`, config `api.root` / `api.base` and `--gen` are the typegen ones (flags, then config, then `app/api` / `/api` / `.laratype`); `--gen` may not be the contract root or inside it (a project root, `--root .`, is exempt: the documented `.laratype` is inside it). `--out` is a file inside the project (default `openapi.json`) and is refused for an absolute path, `..` leading outside, the project itself, a directory, the `--gen` folder or a path that resolves inside it (a folder link included; the comparison is on the location each path resolves to, and runs again right before the write), an existing file this command did not write, a symlink or junction, a file with more than one hard link, or a folder that resolves outside the project. Nothing boots: `bootsApp = false` and `providers()` returns `[]`, so no `register()`, no provider, no database or auth env.
- **Trust.** `types:generate` never executes a contract module: it scans the tree and only type-checks `index.gen.ts` with the TS checker for `api.ts` ([`sauf types:generate`](#sauf-typesgenerate)). `openapi:generate` imports `index.gen.ts` and the contract modules it reaches with jiti, like `sauf dev`, so it evaluates project code during generation: run it only on a contract tree you trust. Both commands may import `app/config/config.ts` when `--root` and `--base` are not both given.
- **The project's own contract runtime.** The command resolves `@laratype/contract` from the project root (`createRequire` from `<project>/package.json`) and imports it with jiti, like the config read; `sauf` takes no runtime dependency on the contract package (it declares it as an optional, type-only peer for the public types), and the document uses the app's own copy (`Symbol.for` brands make the copies agree anyway). An unresolvable package is one diagnostic naming the package and the project, never a raw resolution stack.
- **The tree is imported on its own.** jiti imports `index.gen.ts` and the contract modules with no Vite transform, so a contract module must use resolvable specifiers (no Vite- or tsconfig-only path alias) and must import `./$types` with `import type` (the generated file has no runtime counterpart). A failing import is reported with the index path and one line of the reason.
- **Schemas use the Standard JSON Schema extension.** A slot is converted with `schema["~standard"].jsonSchema.output({ target: "draft-2020-12" })` for a response and `.input(...)` for query/headers/body (what the FE sends and the server validates). zod 4 implements it; a schema without it (valibot 1.x today), or one whose conversion throws or does not return a JSON object, is documented as `{}` with a warning naming the route and slot (`z.date()` and `z.custom()` throw in zod). The result is JSON round-tripped before use: a cyclic or BigInt-bearing conversion falls back, non-JSON values are dropped, and a numeric or integer keyword (`multipleOf`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `maxLength`, `minLength`, `maxItems`, `minItems`, `maxProperties`, `minProperties`, `maxContains`, `minContains`) whose value is a non-finite number (`NaN`, `Infinity`) falls back to `{}` with the same warning instead of serializing as `null`. A non-number value (a draft-04 boolean `exclusiveMinimum`, a string, an object, a `Date`) passes to the JSON round trip and is left to the schema library's dialect; it is not refused by this generator. The root `$schema` is removed (the document declares 2020-12).
- **A schema that refers to itself is hoisted.** A JSON Schema with a `$ref` or `$dynamicRef` starting with `#` is put in `components.schemas.<key>` and its `$ref`s are rebased on it (`#` → the component, `#/$defs/x` → `<component>/$defs/x`, `#anchor` → the pointer of its `$anchor` in the root resource); a recursive schema stays valid and the component is directly `$ref`-erenced (no unused component). Every schema keyword is traversed, so a ref under a draft-07 `dependencies` schema, `additionalItems` or another schema keyword is found and rebased too; `const`, `example`, `enum`, `default`, `examples` and OpenAPI `x-*` vendor metadata are skipped, since a `$ref`-shaped key there is instance data and is left as written (an unknown named anchor is left as written too: there is no target to point at). `$dynamicRef` is rebased only in its JSON Pointer forms (`#`, `#/...`); its anchor form (`#name`) keeps its dynamic scope, so dynamic anchors are not renamed per component (a known limit). A generated `$dynamicRef` pointer is finalized to the component key in the same pass as `$ref`, so no provisional key reaches the document. `<key>` is `<route name>.<slot>`, sanitized to `[A-Za-z0-9._-]`; colliding keys get `_2`, `_3` in **sorted key order**, so the same routes give the same keys whatever order the tree defines them in. A query/header property with a local ref, or with a relative `$ref`, `$dynamicRef` or `$id` that only resolves against the schema root's `$id`, is served by hoisting its whole query/headers schema once (`<route>.query`) and referencing `<component>/properties/<name>`, so `#`, `#/$defs/...`, `#anchor` and a relative `filter.json` keep their original base (the hoisted root keeps its `$id`); a reference-free property, or one whose references are absolute, is inlined. A property that is only `{ "$ref": "#" }` references the hoisted root (`<component>`) and warns that, as a parameter, it overlaps its sibling parameters under form/explode serialization. A pointer segment is RFC 6901 `~0`/`~1`-escaped and then percent-encoded for the URI fragment (RFC 6901 § 6), so a property or `$defs` name with a space, `%`, `#`, a `/` or a non-ASCII character stays one segment (`<component>/properties/a%20b`). A schema with a root `$id` is its own JSON Schema resource: it is inlined and its refs are left alone, except for the base-dependent query/header property above (its whole schema is hoisted with the `$id`); a nested `$id` likewise protects its own `$ref`.
- **Paths.** Path params follow [contract.md › Path params](./contract.md#path-params): `:name` and `:name{re}` become `{name}` with `schema.pattern: "^(?:<re>)$"` (the router matches the whole segment), `:name?` too, with `required: true` and a description because OpenAPI has no optional path parameters. A literal `{`, `}`, `?` or `#` is percent-encoded so it is not read as templating; `*` stays literal; a brace in a param name becomes `_`. A trailing slash is kept.
- **Mapping.** The query and headers schemas' `properties` become `in: query` / `in: header` parameters in declaration order, with `required` from the schema's `required` list; a schema without `properties` adds no parameters (the runtime validation still applies). A headers name OpenAPI reserves (`Accept`, `Content-Type`, `Authorization`, case-insensitive) is still documented, with a warning that consumers ignore its definition. A property value that is a boolean is the draft 2020-12 boolean schema and is emitted as written (`true` accepts, `false` refuses every value); only a value that is neither an object nor a boolean falls back to `{}` with a warning. A body is a required `application/json` request body. The success response is `endpoint.def.status`, which the route guard requires to be an integer from 200 to 299 before any response is assembled (a malformed route is one `OpenApiGenerationError`, never a response keyed `"undefined"`), with the reason phrase (`Success` for a 2xx not in the table) and an `application/json` schema only when the endpoint has a response schema. The errors are `apiRoutes()`' resolved `errors`: grouped by status (ascending), description = their codes, body schema `{ type: "object", required: ["code"], properties: { code: { enum: [...codes] } }, additionalProperties: true }` (an `ErrorDef` carries status and code at run time only; the wire body is `{ code, ...body }`). `auth` becomes the operation's `security`: `[]` for a public endpoint (the rule needs it on every operation), `[{ guard_default: [] }]` for `true`, `[{ guard_<name>: [] }]` for a named guard, each scheme `{ type: "http", scheme: "bearer" }` (see Open questions). A guard's key is its name sanitized to `[A-Za-z0-9._-]`; two identities that sanitize alike (`staff/login`, `staff_login`) get distinct keys with `_2` in sorted name order, and a key is reused only for the same guard identity. Only routes the document keeps declare a scheme: a guard of a same-method, same-template route dropped by the duplicate warning does not add or shift a key. `operationId` is the route name; `summary` is `"<METHOD> <path template>"` (`operation-summary` needs one; the contract has no summary). `info.title`/`version` come from the project's `package.json` (`Laratype API`/`0.0.0`), `servers` is `[{ "url": "/" }]` (a relative server is honest for a document that describes one app's paths), and there is no `license` (app metadata belongs to deployment).
- **Paths OpenAPI cannot tell apart.** OpenAPI identifies a path by its template: `/x/{a}` and `/x/{b}` are the same path, and redocly's `no-identical-paths` rule fails a document that has both. Different methods merge into one path item under the first route's parameter names, and the later operation's path parameters are renamed by position (its own regex/optional schemas are kept). Two routes with the same method and such a template keep the first in tree order (the document's choice, not the router's: `registrationOrder` and `mount()` rank a constrained or more specific route ahead of a plain one) and warn. When the two paths match the same requests (they differ only by parameter names), tree order is just the tie-breaker; otherwise the warning names the other route and its path and says that the requests the router answers with it are not described by the retained operation. `Route.api()` does not refuse two contract routes with the same method and path, so this is a warning, not an error.
- **Determinism and safety.** Paths (keyed by template), component keys and security schemes are sorted; methods have a fixed order (`get, post, put, patch, delete`) and statuses ascend. Every map is built with `Object.fromEntries`, so a route name, property or component key named `__proto__` is an own key and never a prototype. The document carries the contract and its documented metadata (`info`, `servers`) only: no source path, controller, middleware, policy, domain or env value. An existing `--out` is overwritten only when it parses as JSON with a string `openapi` key (a document this command wrote); any other existing file is left untouched and refused with one diagnostic that names `--out` and the rule, never the file's content. An `--out` that is itself a symlink or junction is refused, and so is an existing target with more than one hard link (the write would replace the other name's content too); the nearest existing folder above it must `realpath` inside the project, so a link above the target cannot redirect the write. `--out` may not be the `--gen` folder or a path that resolves inside it (the realpath of the nearest existing ancestor plus the rest, so `./`, a trailing slash, an absolute `--gen`, a case variant on Windows and an in-project folder link are the same place), since the scan writes there before the document; the exclusion and the target are checked again immediately before the write, so a link or file created during the scan or the imports is not written through or replaced on the strength of the earlier check. The check and the write still resolve the path twice: a process that can write the project could swap an ancestor for a link in between, and Node's synchronous `fs` API has no descriptor-relative open to close that residual race (that process can change the imported project code anyway). `--gen` may not be the contract root or inside it. `--out` is written as UTF-8 JSON (2 spaces, a trailing newline) only when its content changed, so a second run leaves the file untouched.
- **Browser purity.** `@laratype/contract` is untouched. `document.ts` and `schema.ts` import no Node module and no schema library (the JSON Schema extension is duck-typed); only `load.ts` and the command touch the filesystem and jiti.
- **Headers are documented, not enforced.** The router validates query and body only (H3 [#106](https://github.com/Laratypes/Laratype/issues/106)); a headers schema is still the contract and is documented.

### Diagnostics
The command exits with code 1 on an error, prefixed `[sauf openapi:generate] `. Scan, config and `--root` / `--base` / `--gen` errors are the [typegen ones](#diagnostics) with that prefix. Its own errors:
- `the project at <dir> has no resolvable @laratype/contract dependency: add it to the project's dependencies`
- `could not load @laratype/contract from <file>: <reason>` and `@laratype/contract (<file>) does not export apiRoutes() and isApiRoot()`
- `could not load the generated appApi from <gen>/api/index.gen.ts: <reason>`
- `the generated appApi in <gen>/api/index.gen.ts must be the root that defineApi returns`
- `apiRoutes() must return an array of routes` and `apiRoutes() returned an invalid route: it needs a name, a method, a path, an endpoint with a 2xx status, errors and auth` (a wrong `options.contract`, a broken copy of the package, or a custom runtime whose `def.status` is not an integer from 200 to 299; the real one never hits them)
- `the output file "<file>" (--out) must be a file inside the project`, `the output file "<file>" (--out) is a directory`, `the output file "<file>" (--out) is not a file` and `the output file "<file>" (--out) is below a path that is not a folder`
- `the output file "<file>" (--out) must not be the generated folder "<gen>" (--gen) or inside it; the scan writes there`
- `the output file "<file>" (--out) already exists and is not an OpenAPI document this command wrote; refusing to overwrite it`
- `the output file "<file>" (--out) has more than one hard link; refusing to overwrite it`
- `the output file "<file>" (--out) is a symbolic link or junction; refusing to write through it`, `the output file "<file>" (--out) is reached through a folder that resolves outside the project; refusing to write through it` and `the output file "<file>" (--out) is below a folder that cannot be resolved; refusing to write through it`
- `the generated folder "<gen>" (--gen) must not be the contract tree root or inside it ("<root>", --root or config api.root)`
- `projectDir must be the project folder`, `--root|--base|--gen|--out must be a string` and `load must be a module loader` (the programmatic API; a caller passing a wrong type)

Warnings, printed and returned in `warnings`; the document is still valid:
- `"<route>": the response|body schema has no JSON Schema (<reason>); it is documented as {}` (`response` or `body`; `<reason>` is the converter's message, a non-finite numeric bound such as `it has a minimum (number) that is not a finite number`, or the missing extension)
- `"<route>": the query|headers schema has no JSON Schema (<reason>); the query|headers parameters are not documented`
- `"<route>": the query|headers property "<name>" is not a JSON Schema; it is documented as {}`
- `"<route>": the query|headers property "<name>" is documented as the whole query|headers schema; its parameter overlaps the sibling parameters` (the property is only `{ "$ref": "#" }`; the parameter uses the hoisted root)
- `"<route>": the header "<name>" is reserved by OpenAPI; its definition is ignored` (`Accept`, `Content-Type`, `Authorization`, any case)
- `"<later>" and "<first>" both answer <METHOD> <template>; keeping "<first>" (first in tree order)`, with `; requests that the router answers with "<later>" ("<route path>") are not described by the retained operation` when the two paths do not match the same requests
- `app/config/config.ts could not be imported on its own ...; using --root / --base and the defaults (app/api, /api) instead of config api` (shared with `types:generate`)
- Every warning is one line: a converter's multi-line message (such as the circular-structure error) is collapsed, then every control or format character in the whole message (ESC and other C0/C1 controls, Unicode format controls such as bidi overrides and isolates, the route and property names and the converter's reason included) is escaped as `\uXXXX`, so none of them reaches the terminal raw; the names are also `JSON.stringify`-quoted.

### Example
[`packages/sauf/__tests__/openapi/`](https://github.com/Laratypes/Laratype/tree/9ca3d3b55e7cac866745478b49eb08d25dee722e/packages/sauf/__tests__/openapi): `document.test.ts` (mapping, reserved headers, boolean and fallback parameter schemas, recursion and anchors, out-of-list keywords, URI-encoded pointers, parent `$id` bases, `$dynamicRef` finalization, guard-key collisions and dropped routes, parent-ref warning, hostile names, format-control escaping), `schema.test.ts` (keyword walk, per-position rebasing, instance/vendor exclusions, base-dependent refs and `$id`s, dynamic refs, bounds, `oneLine`), `command.test.ts` (scan, import, `--out` overwrite, symlink, hard-link, resolved `--gen`-overlap and `..`-prefixed name guards, the pre-write recheck, `--gen`, the missing contract), `types.test-d.ts` (the exported types, the real contract runtime without a cast) and `__snapshots__/fixture-openapi.json`, the whole document of the typegen fixture. On `examples/basic`:
```
$ sauf openapi:generate
... Wrote openapi.json (3 paths) in 12.34ms
```
The generated document is `/api/posts`, `/api/users` and `/api/users/{id}`, and it passes `redocly lint` (4 warnings: no `license`, and no derived 4xx on three public endpoints). No redocly dependency is added: the check is one-off, outside the repository.

### Non-goals
- No ad-hoc routes ([#139](https://github.com/Laratypes/Laratype/issues/139)), no controller, middleware, policy or `.domain()` in the document: none of them is in the contract value.
- No request/response examples, no per-schema titles or descriptions (the contract has none), no error-body schema beyond `{ code, ... }` (an `ErrorDef` is type-level).
- No watch or `sauf dev` integration (G2 [#142](https://github.com/Laratypes/Laratype/issues/142)), no Detective UI (G4 [#144](https://github.com/Laratypes/Laratype/issues/144)).
- No real security scheme per guard until A2 [#120](https://github.com/Laratypes/Laratype/issues/120), no `license` field, no config keys beyond `api.root` / `api.base`.
- No redocly in `package.json`, the lockfile, scripts or CI.

### Open questions
- A2 [#120](https://github.com/Laratypes/Laratype/issues/120): every resolved guard is documented as `http`/`bearer` today, but a session or cookie guard is not a bearer token. A2 decides the real scheme per guard.
- [#244](https://github.com/Laratypes/Laratype/issues/244): a folder syntax for optional path params. Until then an optional `:id?` is a required OpenAPI path parameter with a description.

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
