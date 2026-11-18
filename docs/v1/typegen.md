---
area: typegen
packages: ["sauf", "@laratype/ts-gen"]
issues: [85, 133, 142, 143, 144]
verified-against: Laratype@d70daa7 (+ 256a743 and v0.5.4 @ 053be38 for the 0.5 state)
last-verified: 2026-10-13
---

# Typegen

> `sauf types:generate` is merged ([#133](https://github.com/Laratypes/Laratype/issues/133)); the other sections are planned or proposed. On `v0.5.4`, `packages/ts-gen` contains only `package.json`, so there was no 0.5 generator to port. [#133](https://github.com/Laratypes/Laratype/issues/133) records why the earlier oxc AST approach was dropped: oxc has no type checker, so it cannot infer handler return types. Decision record: S2 [#85](https://github.com/Laratypes/Laratype/issues/85), [DECISIONS-S1-S2.md §S2](https://github.com/Laratypes/Laratype/blob/4c558fd553cbf1c909e2ef71715d289ca003f4c0/spikes/v1/DECISIONS-S1-S2.md#s2-85-decision). The prototype generator is `spikes/v1/s2-api/scripts/gen.mjs` on PR #197 @ 4c558fd.

| Section | Status |
|---|---|
| [sauf types:generate](#sauf-typesgenerate) | merged ([#133](https://github.com/Laratypes/Laratype/issues/133)); config key `api.root` / `api.base` merged ([#104](https://github.com/Laratypes/Laratype/issues/104)); `{ scope, dir }` entries and the walk by brand proposed: PR [#310](https://github.com/Laratypes/Laratype/pull/310) @ cb9a5fe |
| [Watch mode in sauf dev](#watch-mode-in-sauf-dev) | planned → #142 |
| [OpenAPI](#openapi) | proposed: PR <leader fills> @ 7de4bda7 ([#143](https://github.com/Laratypes/Laratype/issues/143)) |
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
- **Generated folder:** `.laratype/` is generated and belongs in `.gitignore`. `--out` must be a folder inside the project that doesn't contain the tree root. The root may be the project itself (`--root .` or `api.root: '.'`); the output folder is then inside the root, and the scan and the dev watcher skip it. Each run rewrites its own files, deletes the `$types.d.ts` of a deleted folder and prunes the folders left empty. Other files under `--out` are never deleted.
- **`index.gen.ts`:** one entry per contract, sorted by tree name. Its imports are relative and extension-less.
- **Strict mode:** the contract types need `strictNullChecks` (`"strict": true`), so the command refuses a project tsconfig without it.
- **`api.ts` uses the TS checker only.** It type-checks `index.gen.ts` through the project tsconfig, with `<out>/types` added to `rootDirs`, and prints `ApiTypes<AppApi>`. It tells endpoints from nodes by type, as `ApiTypes` does (`AnyEndpoint`), not by a `method` field, so an endpoint key such as `method` stays an endpoint; an `AppApi` without the `API_ROOT` brand fails ([#258](https://github.com/Laratypes/Laratype/issues/258)). No contract module is executed. A type error in the tree fails the command.
- **`api.ts` is self-contained:** it has no import, no contract library and no schema library. Named types are inlined structurally, for example a user interface or the contract's `MessageBody`. Types from the TypeScript default lib keep their names (`Date`, `Record<string, boolean>`). A type met again while it is being printed (a recursive type) prints `unknown`. Optional members print as `x?: T | undefined`.
- **Manifest:** a flat map keyed by route name, `'users.posts.update': { method, path, errors }`. `path` is the full path, and `errors` is the endpoint's derived and declared error codes, sorted. `createClient<AppApi>(manifest)` types it for the client, merged ([#109](https://github.com/Laratypes/Laratype/issues/109)); see [client.md › Separate-repo FE](./client.md#separate-repo-fe-generated-manifest).
- **Generated types** are a `type` alias. They satisfy the client's `ApiShape<A>` self-constraint, and they are mutually assignable with `ApiTypes<AppApi>` (tested).
- **`typescript` is an optional peer dependency** of `sauf` (`>=5`). It is loaded with a dynamic `import()` in `types:generate` only, so `sauf dev` and the app never load it.

### Diagnostics
Errors are printed by the command, which exits with code 1, prefixed `[sauf types:generate] `. The scan and config errors (`ScanError`) carry no prefix of their own, so the dev scan behind `$api` prints the same messages prefixed `[laratype:api] `:
- `the contract tree root "<root>" does not exist (set it with --root or config api.root)`
- `the output folder "<dir>" (--out, or the dev plugin's outDir) must be a folder inside the project, not the project itself or outside it`
- `the output folder "<dir>" must not contain the contract tree root "<root>" (--root or config api.root)`
- `the contract tree root "<root>" (--root | config api.root) must be a folder inside the project` (one rule for the flag and the config: the root must be a relative path, so absolute paths, drive letters included, are rejected even when they point inside the project, and so is `..` leading outside; `.`, the project itself, is accepted)
- `base "<base>"` / `config api.base` ` must be "" or a path that starts with "/" and does not end with "/", such as "/api"` (one rule for the scan and the config)
- `<file> and <file> are the same contract (<path>): keep one` (`users.ts` and `users/index.ts`)
- `<file> and <file> have the same name "<name>" ([x] folders are dropped from names)`
- `<file>: a contract needs a name; put it in a named folder (the root index.ts has none)`
- `<dir>: "<folder>" is not a valid param folder: use [name]; optional and rest param folders are not supported`
- `<dir>: folder name "<name>" may only use letters, digits, "_" and "-"`
- `<file>: file name "<stem>" may only use letters, digits, "_" and "-" (use a [x] folder for params)`
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
proposed: PR <leader fills> @ 7de4bda7 ([#143](https://github.com/Laratypes/Laratype/issues/143), G3, M2). It is generated from the contract `appApi` that `defineApi` builds (`.laratype/api/index.gen.ts`), not from the runtime `RouteRegistry`: the registry exists only after a booted app's `RouteAppServiceProvider` ([http.md › Router v2](./http.md#router-v2)), while `Route.api()` resolves the same tree with `apiRoutes(appApi)`, and every contract of the tree is mounted exactly once (a compile and runtime check of `Route.api`). Ad-hoc routes are not in the tree, so they are excluded ([#139](https://github.com/Laratypes/Laratype/issues/139)).

### Public API
[`packages/sauf/src/openapi/` @ 7de4bda7](https://github.com/Laratypes/Laratype/blob/7de4bda7b120638c329cb1e26df3b07f2d6aa9e9/packages/sauf/src/openapi) · [`packages/sauf/src/commands/openapi/generate.ts` @ 7de4bda7](https://github.com/Laratypes/Laratype/blob/7de4bda7b120638c329cb1e26df3b07f2d6aa9e9/packages/sauf/src/commands/openapi/generate.ts)

```
sauf openapi:generate [--root <dir>] [--base <path>] [--gen .laratype] [--out openapi.json]
```

```ts
// packages/sauf/src/openapi (the public entry point; `document.ts`, `schema.ts` and `load.ts` are the modules behind it)
export interface OpenApiContract {                  // the project's own @laratype/contract (see Invariants)
  readonly apiRoutes: (api: object) => ReadonlyArray<ApiRoute>;
  readonly isApiRoot: (value: unknown) => value is object;
}
export interface OpenApiOptions {
  readonly contract: OpenApiContract;
  readonly title?: string;                          // info.title; default "Laratype API"
  readonly version?: string;                        // info.version; default "0.0.0"
}
export interface GeneratedOpenApi { readonly document: OpenApiDocument; readonly warnings: readonly string[] }
export function generateOpenApiDocument(api: object, options: OpenApiOptions): GeneratedOpenApi;   // pure, no Node import

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
// document.ts: the mapping above; schema.ts: standardJsonSchema, hasLocalRefs, rebaseRefs, withParentDefs, isParentRef,
// isSchemaResource and oneLine; load.ts keeps the project load, the package metadata and the writer private.
```

### Invariants
- **Source.** `appApi` from `<gen>/api/index.gen.ts`, the module `sauf types:generate` writes. The command runs the same scan first (`syncContractTree`: `$types.d.ts` and `index.gen.ts`, no TS checker and no `api.ts`), then imports the index and checks `isApiRoot`. `--root`, `--base`, config `api.root` / `api.base` and `--gen` are the typegen ones (flags, then config, then `app/api` / `/api` / `.laratype`); `--gen` may not be inside the contract root (a project root, `--root .`, is exempt: the documented `.laratype` is inside it). `--out` is a file inside the project (default `openapi.json`) and is refused for an absolute path, `..` leading outside, the project itself, a directory, an existing file this command did not write, a symlink or junction, or a folder that resolves outside the project. Nothing boots: `bootsApp = false` and `providers()` returns `[]`, so no `register()`, no provider, no database or auth env.
- **Trust.** The command runs the project's contract modules (jiti), with the same trust as `types:generate` and `sauf dev`: they are project code, evaluated during generation.
- **The project's own contract runtime.** The command resolves `@laratype/contract` from the project root (`createRequire` from `<project>/package.json`) and imports it with jiti, like the config read; `sauf` takes no dependency on the contract package, and the document uses the app's own copy (`Symbol.for` brands make the copies agree anyway). An unresolvable package is one diagnostic naming the package and the project, never a raw resolution stack.
- **The tree is imported on its own.** jiti imports `index.gen.ts` and the contract modules with no Vite transform, so a contract module must use resolvable specifiers (no Vite- or tsconfig-only path alias) and must import `./$types` with `import type` (the generated file has no runtime counterpart). A failing import is reported with the index path and one line of the reason.
- **Schemas use the Standard JSON Schema extension.** A slot is converted with `schema["~standard"].jsonSchema.output({ target: "draft-2020-12" })` for a response and `.input(...)` for query/headers/body (what the FE sends and the server validates). zod 4 implements it; a schema without it (valibot 1.x today), or one whose conversion throws or does not return a JSON object, is documented as `{}` with a warning naming the route and slot (`z.date()` and `z.custom()` throw in zod). The result is JSON round-tripped before use: a cyclic or BigInt-bearing conversion falls back, non-JSON values are dropped, `NaN`/`Infinity` become `null`, and the root `$schema` is removed (the document declares 2020-12).
- **A schema that refers to itself is hoisted.** A JSON Schema with a `$ref` starting with `#` is put in `components.schemas.<key>` and its refs are rebased on it (`#` → the component, `#/$defs/x` → `<component>/$defs/x`); a recursive schema stays valid and the component is directly `$ref`-erenced (no unused component). `<key>` is `<route name>.<slot>`, sanitized to `[A-Za-z0-9._-]`; colliding keys get `_2`, `_3` in **sorted key order**, so the same routes give the same keys whatever order the tree defines them in. A query/header property with refs is hoisted on its own (`<route>.query.<prop>`) with the parent schema's `$defs`, since a parameter's schema resolves against the document; a property that is only `{ "$ref": "#" }` has nothing to complete it and is documented as `{}` with a warning. A schema with a root `$id` is its own JSON Schema resource: it is inlined and its refs are left alone.
- **Paths.** Path params follow [contract.md › Path params](./contract.md#path-params): `:name` and `:name{re}` become `{name}` with `schema.pattern: "^(?:<re>)$"` (the router matches the whole segment), `:name?` too, with `required: true` and a description because OpenAPI has no optional path parameters. A literal `{`, `}`, `?` or `#` is percent-encoded so it is not read as templating; `*` stays literal; a brace in a param name becomes `_`. A trailing slash is kept.
- **Mapping.** The query and headers schemas' `properties` become `in: query` / `in: header` parameters in declaration order, with `required` from the schema's `required` list; a schema without `properties` adds no parameters (the runtime validation still applies). A body is a required `application/json` request body. The success response is `endpoint.def.status` (reason phrase, `Success` for an unknown 2xx), with an `application/json` schema only when the endpoint has a response schema. The errors are `apiRoutes()`' resolved `errors`: grouped by status (ascending), description = their codes, body schema `{ type: "object", required: ["code"], properties: { code: { enum: [...codes] } }, additionalProperties: true }` (an `ErrorDef` carries status and code at run time only; the wire body is `{ code, ...body }`). `auth` becomes the operation's `security`: `[]` for a public endpoint (the rule needs it on every operation), `[{ guard_default: [] }]` for `true`, `[{ guard_<name>: [] }]` for a named guard, each scheme `{ type: "http", scheme: "bearer" }` (see Open questions). `operationId` is the route name; `summary` is `"<METHOD> <path template>"` (`operation-summary` needs one; the contract has no summary). `info.title`/`version` come from the project's `package.json` (`Laratype API`/`0.0.0`), `servers` is `[{ "url": "/" }]` (a relative server is honest for a document that describes one app's paths), and there is no `license` (app metadata belongs to deployment).
- **Paths OpenAPI cannot tell apart.** OpenAPI identifies a path by its template: `/x/{a}` and `/x/{b}` are the same path, and redocly's `no-identical-paths` rule fails a document that has both. Different methods merge into one path item under the first route's parameter names, and the later operation's path parameters are renamed by position (its own regex/optional schemas are kept). Two routes with the same method and such a template keep the first in tree order and warn. `Route.api()` does not refuse two contract routes with the same method and path (Hono serves the first), so this is a warning, not an error.
- **Determinism and safety.** Paths (keyed by template), component keys and security schemes are sorted; methods have a fixed order (`get, post, put, patch, delete`) and statuses ascend. Every map is built with `Object.fromEntries`, so a route name, property or component key named `__proto__` is an own key and never a prototype. The document carries the contract and its documented metadata (`info`, `servers`) only: no source path, controller, middleware, policy, domain or env value. An existing `--out` is overwritten only when it parses as JSON with a string `openapi` key (a document this command wrote); any other existing file is left untouched and refused with one diagnostic that names `--out` and the rule, never the file's content. The write goes through no symlink or junction and no folder whose `realpath` leaves the project, and `--gen` may not be inside the contract root. `--out` is written as UTF-8 JSON (2 spaces, a trailing newline) only when its content changed, so a second run leaves the file untouched.
- **Browser purity.** `@laratype/contract` is untouched. `document.ts` and `schema.ts` import no Node module and no schema library (the JSON Schema extension is duck-typed); only `load.ts` and the command touch the filesystem and jiti.
- **Headers are documented, not enforced.** The router validates query and body only (H3 [#106](https://github.com/Laratypes/Laratype/issues/106)); a headers schema is still the contract and is documented.

### Diagnostics
The command exits with code 1 on an error, prefixed `[sauf openapi:generate] `. Scan, config and `--root` / `--base` / `--gen` errors are the [typegen ones](#diagnostics) with that prefix. Its own errors:
- `the project at <dir> has no resolvable @laratype/contract dependency: add it to the project's dependencies`
- `could not load @laratype/contract from <file>: <reason>` and `@laratype/contract (<file>) does not export apiRoutes() and isApiRoot()`
- `could not load the generated appApi from <gen>/api/index.gen.ts: <reason>`
- `the generated appApi in <gen>/api/index.gen.ts must be the root that defineApi returns`
- `apiRoutes() must return an array of routes` and `apiRoutes() returned an invalid route: it needs a name, a method, a path, an endpoint, errors and auth` (a wrong `options.contract` or a broken copy of the package; the real one never hits them)
- `the output file "<file>" (--out) must be a file inside the project`, `the output file "<file>" (--out) is a directory`, `the output file "<file>" (--out) is not a file` and `the output file "<file>" (--out) is below a path that is not a folder`
- `the output file "<file>" (--out) already exists and is not an OpenAPI document this command wrote; refusing to overwrite it`
- `the output file "<file>" (--out) is a symbolic link or junction; refusing to write through it`, `the output file "<file>" (--out) is reached through a folder that resolves outside the project; refusing to write through it` and `the output file "<file>" (--out) is below a folder that cannot be resolved; refusing to write through it`
- `the generated folder "<gen>" (--gen) must not be inside the contract tree root "<root>" (--root or config api.root)`
- `projectDir must be the project folder`, `--root|--base|--gen|--out must be a string` and `load must be a module loader` (the programmatic API; a caller passing a wrong type)

Warnings, printed and returned in `warnings`; the document is still valid:
- `"<route>": the response|body schema has no JSON Schema (<reason>); it is documented as {}` (`response` or `body`; `<reason>` is the converter's message)
- `"<route>": the query|headers schema has no JSON Schema (<reason>); the query|headers parameters are not documented`
- `"<route>": the query|headers property "<name>" is not a JSON Schema object; it is documented as {}` and `"<route>": the ... property "<name>" only refers to the ... schema itself; it is documented as {}`
- `"<later>" and "<first>" both answer <METHOD> <template>; keeping "<first>"`
- `app/config/config.ts could not be imported on its own ...; using --root / --base and the defaults (app/api, /api) instead of config api` (shared with `types:generate`)
- Every warning is one line: a converter's multi-line message (such as the circular-structure error) is collapsed, and route and property names are `JSON.stringify`-quoted, so a control character or an ANSI escape never reaches the terminal raw.

### Example
[`packages/sauf/__tests__/openapi/`](https://github.com/Laratypes/Laratype/tree/7de4bda7b120638c329cb1e26df3b07f2d6aa9e9/packages/sauf/__tests__/openapi): `document.test.ts` (mapping, fallbacks, recursion, collisions, hostile names, warning hygiene), `command.test.ts` (scan, import, `--out` overwrite and symlink guards, `--gen`, the missing contract), `types.test-d.ts` (the exported types) and `__snapshots__/fixture-openapi.json`, the whole document of the typegen fixture. On `examples/basic`:
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
