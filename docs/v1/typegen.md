---
area: typegen
packages: ["sauf", "@laratype/ts-gen"]
issues: [85, 133, 142, 143, 144]
verified-against: Laratype@d70daa7 (+ 256a743 and v0.5.4 @ 053be38 for the 0.5 state)
last-verified: 2026-10-13
---

# Typegen

> `sauf types:generate` is merged ([#133](https://github.com/Laratypes/Laratype/issues/133)); the other sections are planned. On `v0.5.4`, `packages/ts-gen` contains only `package.json`, so there was no 0.5 generator to port. [#133](https://github.com/Laratypes/Laratype/issues/133) records why the earlier oxc AST approach was dropped: oxc has no type checker, so it cannot infer handler return types. Decision record: S2 [#85](https://github.com/Laratypes/Laratype/issues/85), [DECISIONS-S1-S2.md §S2](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/DECISIONS-S1-S2.md#s2-85-decision). The prototype generator is `spikes/v1/s2-api/scripts/gen.mjs` on PR #197 @ 4c558fd.

| Section | Status |
|---|---|
| [sauf types:generate](#sauf-typesgenerate) | merged ([#133](https://github.com/Laratypes/Laratype/issues/133)); config key `api.root` / `api.base` merged ([#104](https://github.com/Laratypes/Laratype/issues/104)) |
| [Watch mode in sauf dev](#watch-mode-in-sauf-dev) | planned → #142 |
| [OpenAPI](#openapi) | planned → #143 |
| [Detective](#detective) | planned → #144 |

---

## sauf types:generate

### Status
merged ([#133](https://github.com/Laratypes/Laratype/issues/133)). The config key `api.root` / `api.base` is merged ([#104](https://github.com/Laratypes/Laratype/issues/104)). Running it as step 4 of `sauf build` is part of the planned [build steps](./build.md#sauf-build-steps), and the watch in `sauf dev` is planned → [#142](https://github.com/Laratypes/Laratype/issues/142).

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
// ApiPluginApi: rescan(), restart() (rescans when $api was imported before), inTree(file), isGenerated(file): used by sauf dev --hmr
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
| `.laratype/api/index.gen.ts` | `export const appApi = defineApi({ 'users.posts': { contract, path, scopes, dirs }, ... })` and `export type AppApi = typeof appApi`, imported as `$api` |
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
- **Options:** the root and base come from config `api.root` / `api.base` (`app/config/config.ts`), and `--root` / `--base` override them; the defaults are `app/api` → `/api` (merged, [#104](https://github.com/Laratypes/Laratype/issues/104)). The command imports `app/config/config.ts` on its own and boots no provider, so it needs no database or auth env. With both `--root` and `--base` given it does not import the config at all. `--out` is a flag only (default `.laratype`).
- **Generated folder:** `.laratype/` is generated and belongs in `.gitignore`. `--out` must be a folder inside the project that doesn't contain the tree root. Each run rewrites its own files, deletes the `$types.d.ts` of a deleted folder and prunes the folders left empty. Other files under `--out` are never deleted.
- **`index.gen.ts`:** one entry per contract, sorted by tree name. Its imports are relative and extension-less.
- **Strict mode:** the contract types need `strictNullChecks` (`"strict": true`), so the command refuses a project tsconfig without it.
- **`api.ts` uses the TS checker only.** It type-checks `index.gen.ts` through the project tsconfig, with `<out>/types` added to `rootDirs`, and prints `ApiTypes<AppApi>`. No contract module is executed. A type error in the tree fails the command.
- **`api.ts` is self-contained:** it has no import, no contract library and no schema library. Named types are inlined structurally, for example a user interface or the contract's `MessageBody`. Types from the TypeScript default lib keep their names (`Date`, `Record<string, boolean>`). A type met again while it is being printed (a recursive type) prints `unknown`. Optional members print as `x?: T | undefined`.
- **Manifest:** a flat map keyed by route name, `'users.posts.update': { method, path, errors }`. `path` is the full path, and `errors` is the endpoint's derived and declared error codes, sorted. `createClient<AppApi>(manifest)` types it for the client, merged ([#109](https://github.com/Laratypes/Laratype/issues/109)); see [client.md › Separate-repo FE](./client.md#separate-repo-fe-generated-manifest).
- **Generated types** are a `type` alias. They satisfy the client's `ApiShape<A>` self-constraint, and they are mutually assignable with `ApiTypes<AppApi>` (tested).
- **`typescript` is an optional peer dependency** of `sauf` (`>=5`). It is loaded with a dynamic `import()` in `types:generate` only, so `sauf dev` and the app never load it.

### Diagnostics
Errors are printed by the command, which exits with code 1, prefixed `[sauf types:generate] `. The scan and config errors (`ScanError`) carry no prefix of their own, so the dev scan behind `$api` prints the same messages prefixed `[laratype:api] `:
- `the contract tree root "<root>" does not exist (set it with --root or config api.root)`
- `the output folder "<dir>" (--out, or the dev plugin's outDir) must be a folder inside the project, not the project itself or outside it`
- `the output folder "<dir>" must not contain the contract tree root "<root>" (--root or config api.root)`
- `the contract tree root "<root>" (--root | config api.root) must be a folder inside the project` (one rule for the flag and the config: the root must be a relative path, so absolute paths, drive letters included, are rejected even when they point inside the project, and so is `..` leading outside)
- `base "<base>"` / `config api.base` ` must be "" or a path that starts with "/" and does not end with "/", such as "/api"` (one rule for the scan and the config)
- `<file> and <file> are the same contract (<path>): keep one` (`users.ts` and `users/index.ts`)
- `<file> and <file> have the same name "<name>" ([x] folders are dropped from names)`
- `<file>: a contract needs a name; put it in a named folder (the root index.ts has none)`
- `<dir>: "<folder>" is not a valid param folder: use [name]; optional and rest param folders are not supported`
- `<dir>: folder name "<name>" may only use letters, digits, "_" and "-"`
- `<file>: file name "<stem>" may only use letters, digits, "_" and "-" (use a [x] folder for params)`
- `config api must be { root?, base? }`, `config api.root must be a folder, relative to the project`, `config api.base must be "" or a path that starts with "/" and does not end with "/", such as "/api"`, `could not load app/config/config.ts (see the error above)`
- `the contract types need strictNullChecks: set "strict": true in <tsconfig>`
- `the contract tree does not type-check:` followed by the tsc diagnostics
- `sauf types:generate needs the typescript package (>=5): add it to the project's devDependencies`

### Example
[`packages/sauf/__tests__/typegen/`](../../packages/sauf/__tests__/typegen/):
- `fixtures/project` is a tree;
- `__snapshots__/` holds its generated files;
- `fixtures/fe` is a separate FE compiled against `api.ts` only.

### Non-goals
- No watch (G2 [#142](https://github.com/Laratypes/Laratype/issues/142)), no OpenAPI (G3 [#143](https://github.com/Laratypes/Laratype/issues/143)).
- No server code: the dev scan behind `$api` (`syncContractTree`, the `laratype:api` plugin) reuses this scan and emit without the TS checker ([http.md › Router v2](./http.md#router-v2)).

### Open questions
- Resolved: the earlier `laratype-api.d.ts` + `rollup-plugin-dts` task is superseded by S2 ([#133](https://github.com/Laratypes/Laratype/issues/133)).

### Acceptance
[#133 Done when](https://github.com/Laratypes/Laratype/issues/133)

---

## Watch mode in sauf dev

### Status
planned → [#142](https://github.com/Laratypes/Laratype/issues/142) (G2, M3).

### Design (non-binding)
- **Watch:** `sauf dev` watches the [contract folder tree](./contract.md#contract-folder-tree) for file add, rename and delete, and regenerates `$types.d.ts` (under `.laratype/types/`) and `.laratype/api/index.gen.ts` incrementally, so a monorepo FE sees new types without a restart.
- **Server:** in dev the server rescans the tree on the same events.

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
