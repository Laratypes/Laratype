---
area: config
packages: ["@laratype/core", "@laratype/support"]
issues: [152]
verified-against: Laratype@24b46ab (+ PR #300 @ 25d57c9; 0.5 state checked on 256a743 and v0.5.4 @ 053be38)
last-verified: 2026-10-25
---

# Config and env

Typed configuration files, `config()` with dot-path inference, and an environment validated at boot.

**State on master (0.5):** checked on `256a743`. The same files are unchanged on `v0.5.4`.
- The config type is one fixed interface, `LaratypeConfig.AppConfig`, in `@laratype/support` ([`Config.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/support/src/contracts/Config.ts#L18-L31)). The example app's files are `app/config/config.ts`, `auth.ts` and `providers.ts`.
- `Config.get(keys)` takes a path of keys typed against that interface, reads `globalThis.__laratype_config`, and throws `ConfigLoaderNotLoadYet` before the config is loaded ([`config/Config.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/support/src/config/Config.ts#L7-L24)). It still works: the K1 loader keeps filling it from `app/config/config.ts`.
- The optional key `api: { root?, base? }` sets the contract tree root and its URL base (default `app/api` → `/api`), read by `sauf types:generate` and the dev scan behind `$api` (merged, [#104](https://github.com/Laratypes/Laratype/issues/104); [contract.md › Contract folder tree](./contract.md#contract-folder-tree)).
- `Env.get(key, defaultVal)` reads `process.env` with no validation ([`environ/Env.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/support/src/environ/Env.ts#L3-L8)).

| Section | Status |
|---|---|
| [Config files and config()](#config-files-and-config) | proposed: PR <leader fills> @ 2b6fd00 |
| [Environment validation](#environment-validation) | proposed: PR <leader fills> @ 2b6fd00 |

---

## Config files and config()

### Status
proposed: PR <leader fills> @ 2b6fd00 (K1 [#152](https://github.com/Laratypes/Laratype/issues/152), K4 [#314](https://github.com/Laratypes/Laratype/issues/314)).

### Public API
[`core/src/config.ts` @ 2b6fd00](https://github.com/Laratypes/Laratype/blob/2b6fd0040b3b6d771a5343387c6090c120dd3ccb/packages/core/src/config.ts), [`ConfigLoadServiceProvider.ts` @ 2b6fd00](https://github.com/Laratypes/Laratype/blob/2b6fd0040b3b6d771a5343387c6090c120dd3ccb/packages/support/src/config/ConfigLoadServiceProvider.ts)

```ts
// @laratype/core
export interface Register {}            // augmented by the app: { config: { <file>: typeof <file> } }
export type AppConfigs = Register extends { config: infer C } ? C : Record<string, unknown>
export type ConfigPath<T = AppConfigs> = /* every dot path of T */ string
export type ConfigValue<P extends string, T = AppConfigs> = /* the value at P */ unknown
export const defineConfig: <const T extends object>(config: T) => T
export function config<const P extends ConfigPath>(path: P): ConfigValue<P>
/** @internal Called by ConfigLoadServiceProvider. */
export const setConfigs: (configs: Readonly<Record<string, unknown>>) => void
```

### Invariants
- **Files:** one file per area in `app/config/*.ts`, default-exporting `defineConfig({...})`. The app manifest collects them (B1, merged [#125](https://github.com/Laratypes/Laratype/issues/125)); `providers.ts` and the env file (`env.ts`) are not configs.
- **Registration (Q16):** the app types `config()` by module augmentation, the same pattern as the auth `Register` ([auth.md › Typed Register](./auth.md#typed-register)):
  ```ts
  import type database from './database'
  declare module '@laratype/core' { interface Register { config: { database: typeof database } } }
  ```
  Without a registration, any string path is accepted and the value is `unknown`.
- **Paths:** the first segment is the file name: `config('database.default')` reads `default` of `app/config/database.ts`. 0.5's single file reads as `config('config.<key>')`.
- **Typing:** `defineConfig` keeps literal values (`'mysql'`, `3306`), so driver names are typed. A path stops at arrays, functions and classes, and after 8 levels. An optional key, or a key read through an index signature, adds `| undefined`. A key that contains a dot ends a path.
- **Lookup:** at each level, the whole rest of the path as a key first, then the segment before the first dot. Own data properties are values, and so is a getter, own or inherited (`URL.host` on an instance): `ConfigPath` types a class instance's members (`config('mail.url.host')` is `string`). A getter is app code: it runs when the path reads it, and an error it throws propagates. A data property above the object (a method such as `URL.prototype.toString`, or a class's prototype constant) is never read, so `config('app.url.toString')` is `undefined` even though the type still lists it as a function leaf, like `config('mail.transport')` (an own function). The keys `constructor`, `prototype` and `__proto__` never name a value (as a whole path or a segment), nor does an `Object.prototype` member; a path that is not a string is a miss (`undefined`), so app code on it never runs. A key missing at run time gives `undefined`.
- **Boot:** `ConfigLoadServiceProvider` (after `EnvLoadServiceProvider`) imports `app/config/config.ts` first, fills 0.5's `Config.get()`, then imports the other config files together, in parallel, and fills the store in file order. A failing file fails the boot with the first failure in file order, not the first to settle; every other file settles before the failure is raised, so a file that never settles hangs the boot. `config()` is sync, so a config file (or a module it imports) can't call `config()` at load time. `app/config/config.ts` stays required.
- The store is kept on `globalThis` (`__laratype_configs`), like `HTTP_APP`, until the `@laratype` packages are real externals ([#188](https://github.com/Laratypes/Laratype/issues/188)).

### Diagnostics
- Runtime, before boot: `[@laratype/core] config('<path>') ran before the configs were loaded (ConfigLoadServiceProvider)`.
- Runtime, no config file: `app/config/config.ts not found: the app manifest has no config` (unchanged from 0.5).
- Type-only (`core/__tests__/config.test-d.ts`): an unknown path, a path into an array, a function, a class or through a dotted key fails with TS2345, the parameter type being the union of the registered paths. With the [example](./examples/config/proposed/config.ts)'s registration, `config('cache.default')` gives:
  `error TS2345: Argument of type '"cache.default"' is not assignable to parameter of type '"database" | "database.default" | "database.connections" | "database.connections.mysql" | "database.connections.mysql.host" | "database.connections.mysql.port"'.`

### Example
[`examples/config/proposed/config.ts`](./examples/config/proposed/config.ts).

### Non-goals
- No `config(path, default)` and no runtime writes (`config.set`).
- No generated registration: the app writes the `declare module` block. Generating it from the manifest is a follow-up.

### Open questions
- Resolved: the config type is registered by a `declare module` interface, like the auth `Register` (Q16, [#152](https://github.com/Laratypes/Laratype/issues/152#issuecomment-6099909669)).

### Acceptance
[#152 Done when](https://github.com/Laratypes/Laratype/issues/152)

---

## Environment validation

### Status
proposed: PR <leader fills> @ 2b6fd00 (K1 [#152](https://github.com/Laratypes/Laratype/issues/152), K4 [#314](https://github.com/Laratypes/Laratype/issues/314)).

### Public API
[`core/src/env.ts` @ 2b6fd00](https://github.com/Laratypes/Laratype/blob/2b6fd0040b3b6d771a5343387c6090c120dd3ccb/packages/core/src/env.ts), [`support/src/environ/validateEnv.ts` @ 2b6fd00](https://github.com/Laratypes/Laratype/blob/2b6fd0040b3b6d771a5343387c6090c120dd3ccb/packages/support/src/environ/validateEnv.ts)

```ts
// @laratype/core
export const ENV_CONFIG_NAME = 'env'
export interface EnvDefinition<S extends StandardSchemaV1 = StandardSchemaV1> { readonly schema: S }
export const defineEnv: <S extends StandardSchemaV1>(schema: S) => EnvDefinition<S>

// @laratype/support
export interface EnvIssue { readonly name: string; readonly message: string }
export class EnvValidationError extends Error {
  readonly name: 'EnvValidationError'
  readonly issues: ReadonlyArray<EnvIssue>
}
```

### Invariants
- **Schema:** any Standard Schema (zod 4.6.6+, valibot, arktype, ...), validated with `@laratype/contract`'s `validate`, sync or async.
- **File (Q18):** `app/config/env.ts` default-exports `defineEnv(schema)`. The manifest already collects it with the configs; no build change.
- **Boot:** `EnvLoadServiceProvider` loads the env file (`.env`, ...) with or without an app manifest — a CLI helper or a unit test still gets its `.env` — then validates a copy of `process.env` with the schema, before any config file loads. `app/config/auth.ts` is the exception: `PassportServiceProvider.register()` loads it (and the env file) before the providers boot, so a value it reads has not been validated yet, but an invalid env still fails the boot ([auth.md › Guards in the container](./auth.md#guards-in-the-container)). An app without `env.ts`, or without a manifest, is not validated; a manifest with a scan error still fails the boot. The schema's output is not written back: `process.env` keeps its strings.
- **Error (Q19):** an invalid env throws one `EnvValidationError` listing every failing variable once (its name + a fixed message), and boot fails. The vendor issues are not kept.
- **Values are never printed:** a failing line is the variable's name and `does not match the schema`; no text from the schema is printed. A schema transforms its input before a check (lowercase, `decodeURIComponent`, base64) and a validator then quotes that transformed value, which no redaction of the raw env value can catch, so no validator text is trusted. An error the schema throws (a transform's `new URL(value)`) is replaced by one that withholds its name and message and has no `cause`. The printed name is the issue's first path segment (`path[0]`, and `path[0].key` when the segment is an object) — the only schema-derived text printed; a dotted name (`db.password`) is one variable name. A path is app data, not env data, but a schema that re-keys by a value (`path: [value]`) would print that value, so the name is printed only when it is a variable of the environment, or a name the schema declares: a key of the issues it reports for an empty object, which holds no env value (a missing variable). Any other path, and issues with no path, share the `(environment)` line.
- **Breaking change (0.5):** an `app/config/env.ts` that is a plain 0.5 config (a default-exported object, not `defineEnv(schema)`) no longer boots: that file is the env file (Q18), so `EnvLoadServiceProvider` throws `TypeError: ... must default-export defineEnv(schema) (a 0.5 config named env: rename the file, e.g. app/config/environment.ts)`. Migration: rename the file, for example to `app/config/environment.ts`; the manifest collects it as a config, and the app adds it to the config `declare module` to type `config('environment.<key>')`.

### Diagnostics
- Runtime, invalid env:
  ```
  [@laratype/support] Invalid environment (app/config/env.ts), <n> failing:
  - <NAME>: does not match the schema
  ```
  `<n>` is the number of failing variables, plus the `(environment)` line when issues have no path; a name is listed once however many of its checks failed.
- Runtime, the schema throws: `[@laratype/support] the schema of app/config/env.ts threw while validating the environment; the error is withheld since it may hold a value`.
- Runtime, `env.ts` without `defineEnv`: `TypeError: [@laratype/support] app/config/env.ts must default-export defineEnv(schema) (a 0.5 config named env: rename the file, e.g. app/config/environment.ts)`.
- Runtime, not a schema: `TypeError: [@laratype/core] defineEnv(schema): schema must be a Standard Schema (zod 4.6.6+, valibot, arktype, ...)`.
- Type-only (`core/__tests__/config.test-d.ts`), a value that is not a Standard Schema:
  - `defineEnv({ PORT: 'number' })`: `error TS2353: Object literal may only specify known properties, and 'PORT' does not exist in type 'StandardSchemaV1<unknown, unknown>'.`
  - `defineEnv((value: unknown) => value)`: `error TS2345: Argument of type '(value: unknown) => unknown' is not assignable to parameter of type 'StandardSchemaV1<unknown, unknown>'.`

### Example
[`examples/config/proposed/config.ts`](./examples/config/proposed/config.ts).

### Non-goals
- No typed accessor for the validated env, and no writing defaults or coerced values back to `process.env` (follow-up).

### Open questions
- Resolved: `defineEnv` lives in `app/config/env.ts`, which the manifest loads (Q18, [#152](https://github.com/Laratypes/Laratype/issues/152#issuecomment-6099909669)).
- Resolved: an invalid env lists every failing variable and fails boot; values are never printed (Q19, [#152](https://github.com/Laratypes/Laratype/issues/152#issuecomment-6099909669)).
- Open: no allow-list of non-secret ambient variables (`NODE_ENV`, `APP_ENV`) that would get their schema text printed. K4 [#314](https://github.com/Laratypes/Laratype/issues/314): this spec names no such list, and printing a message for a listed variable still prints schema text, which can quote any value (another variable's, a transformed one), so every variable keeps the fixed message: secrecy wins by default.

### Acceptance
[#152 Done when](https://github.com/Laratypes/Laratype/issues/152)
