---
area: config
packages: ["@laratype/core", "@laratype/support"]
issues: [152]
verified-against: Laratype@24b46ab (+ PR feat/k1-typed-config-define-env @ 318315c; 0.5 state checked on 256a743 and v0.5.4 @ 053be38)
last-verified: 2026-10-22
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
| [Config files and config()](#config-files-and-config) | proposed: PR feat/k1-typed-config-define-env @ 318315c |
| [Environment validation](#environment-validation) | proposed: PR feat/k1-typed-config-define-env @ 318315c |

---

## Config files and config()

### Status
proposed: PR feat/k1-typed-config-define-env @ 318315c (K1 [#152](https://github.com/Laratypes/Laratype/issues/152)).

### Public API
[`core/src/config.ts` @ 318315c](https://github.com/Laratypes/Laratype/blob/318315c7f709423032c5fbd0a6f2272b647b4a09/packages/core/src/config.ts), [`ConfigLoadServiceProvider.ts` @ 318315c](https://github.com/Laratypes/Laratype/blob/318315c7f709423032c5fbd0a6f2272b647b4a09/packages/support/src/config/ConfigLoadServiceProvider.ts)

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
- **Typing:** `defineConfig` keeps literal values (`'mysql'`, `3306`), so driver names are typed. A path stops at arrays and functions and after 8 levels. An optional key, or a key read through an index signature, adds `| undefined`. A key that contains a dot ends a path.
- **Lookup:** at each level, the whole rest of the path as a key first, then the segment before the first dot. Own keys of plain objects; on a class instance (a `URL`, a client) its members too; never `Object.prototype` members. A key missing at run time gives `undefined`.
- **Boot:** `ConfigLoadServiceProvider` (after `EnvLoadServiceProvider`) imports every config file, one after the other, then fills the store. `config()` is sync, so a config file (or a module it imports) can't call `config()` at load time. `app/config/config.ts` stays required and loads first: it fills 0.5's `Config.get()` before the other files load.
- The store is kept on `globalThis` (`__laratype_configs`), like `HTTP_APP`, until the `@laratype` packages are real externals ([#188](https://github.com/Laratypes/Laratype/issues/188)).

### Diagnostics
- Runtime, before boot: `[@laratype/core] config('<path>') ran before the configs were loaded (ConfigLoadServiceProvider)`.
- Runtime, no config file: `app/config/config.ts not found: the app manifest has no config` (unchanged from 0.5).
- Type-only (`core/__tests__/config.test-d.ts`): an unknown path, a path into an array, a function or through a dotted key fails with `Argument of type '"<path>"' is not assignable to parameter of type ...`.

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
proposed: PR feat/k1-typed-config-define-env @ 318315c (K1 [#152](https://github.com/Laratypes/Laratype/issues/152)).

### Public API
[`core/src/env.ts` @ 318315c](https://github.com/Laratypes/Laratype/blob/318315c7f709423032c5fbd0a6f2272b647b4a09/packages/core/src/env.ts), [`support/src/environ/validateEnv.ts` @ 318315c](https://github.com/Laratypes/Laratype/blob/318315c7f709423032c5fbd0a6f2272b647b4a09/packages/support/src/environ/validateEnv.ts)

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
- **Schema:** any Standard Schema (zod 3.25+, valibot, arktype, ...), validated with `@laratype/contract`'s `validate`, sync or async.
- **File (Q18):** `app/config/env.ts` default-exports `defineEnv(schema)`. The manifest already collects it with the configs; no build change.
- **Boot:** `EnvLoadServiceProvider` loads the env file (`.env`, ...), then validates a copy of `process.env` with the schema, before any config file loads. An app without `env.ts` is not validated. The schema's output is not written back: `process.env` keeps its strings.
- **Error (Q19):** an invalid env throws one `EnvValidationError` listing every failing variable (name + the schema's message), and boot fails. The vendor issues are not kept.
- **Values are never printed:** each message has `***` in place of the failing variable's value and of every env value of 8+ characters (a secret that a refinement quotes under another name or at the root), raw, trimmed and JSON-escaped. A value shorter than 8 characters is cut only where it stands alone (`prod` leaves `"production"`), and a short value of another variable is not cut. Schema text equal to a long env value shows as `***`. An issue with no path is named `(environment)`.

### Diagnostics
- Runtime, invalid env:
  ```
  [@laratype/support] Invalid environment (app/config/env.ts), <n> failing:
    - <NAME>: <message>
  ```
- Runtime, `env.ts` without `defineEnv`: `TypeError: [@laratype/support] app/config/env.ts must default-export defineEnv(schema)`.
- Runtime, not a schema: `TypeError: [@laratype/core] defineEnv(schema): schema must be a Standard Schema (zod 3.25+, valibot, arktype, ...)`.
- Type-only: `defineEnv({ ... })` with a value that is not a Standard Schema fails to compile.

### Example
[`examples/config/proposed/config.ts`](./examples/config/proposed/config.ts).

### Non-goals
- No typed accessor for the validated env, and no writing defaults or coerced values back to `process.env` (follow-up).

### Open questions
- Resolved: `defineEnv` lives in `app/config/env.ts`, which the manifest loads (Q18, [#152](https://github.com/Laratypes/Laratype/issues/152#issuecomment-6099909669)).
- Resolved: an invalid env lists every failing variable (name + Standard Schema message) and fails boot; values are never printed (Q19, [#152](https://github.com/Laratypes/Laratype/issues/152#issuecomment-6099909669)).

### Acceptance
[#152 Done when](https://github.com/Laratypes/Laratype/issues/152)
