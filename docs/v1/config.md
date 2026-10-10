---
area: config
packages: ["@laratype/core"]
issues: [152]
verified-against: Laratype@256a743 (0.5 state also checked on v0.5.4 @ 053be38)
last-verified: 2026-10-10
---

# Config and env

Typed configuration files, `config()` with dot-path inference, and an environment validated at boot.

> **Planned only.** No v1 config code exists. Every section is `planned → #N` and holds a **Design (non-binding)** note built from K1 [#152](https://github.com/Laratypes/Laratype/issues/152) and the "Added to scope" comment on DOC8 [#219](https://github.com/Laratypes/Laratype/issues/219). A name in backticks below is the name those sources use. Its parameters and return type are not specified yet. Public API, Invariants, Diagnostics and Example are left out until code lands ([README](./README.md)).

**State on master (0.5):** checked on `256a743`. The same files are unchanged on `v0.5.4`.
- The config type is one fixed interface, `LaratypeConfig.AppConfig`, in `@laratype/support` ([`Config.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/support/src/contracts/Config.ts#L18-L31)). The example app's files are `app/config/config.ts`, `auth.ts` and `providers.ts`.
- `Config.get(keys)` takes a path of keys typed against that interface, reads `globalThis.__laratype_config`, and throws `ConfigLoaderNotLoadYet` before the config is loaded ([`config/Config.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/support/src/config/Config.ts#L7-L24)).
- `Env.get(key, defaultVal)` reads `process.env` with no validation ([`environ/Env.ts` @ 256a743](https://github.com/Laratypes/Laratype/blob/256a7432bb24d6812e4b0903cd1d6528b0607fdf/packages/support/src/environ/Env.ts#L3-L8)).

| Section | Status |
|---|---|
| [Config files and config()](#config-files-and-config) | planned → #152 |
| [Environment validation](#environment-validation) | planned → #152 |

---

## Config files and config()

### Status
planned → [#152](https://github.com/Laratypes/Laratype/issues/152) (K1, M3). Depends on D4 #99.

### Design (non-binding)
- **Files:** one file per area in `app/config/*.ts`, written with `defineConfig` ([overview.md › Project structure](./overview.md#project-structure)). The build manifest collects them (B1 [#125](https://github.com/Laratypes/Laratype/issues/125)).
- **Reading:** `config('database.default')` infers the value type from the dot path. The type comes from `typeof configs`, the collected config files.
- **Per-area files named by issues:** `config/cors.ts` ([#164](https://github.com/Laratypes/Laratype/issues/164)), `config/cache.ts` ([#166](https://github.com/Laratypes/Laratype/issues/166)), `config/filesystems.ts` ([#168](https://github.com/Laratypes/Laratype/issues/168)), `config/mail.ts` ([#170](https://github.com/Laratypes/Laratype/issues/170)).
- **Drivers:** the driver [Manager](./services.md#driver-manager) types its default driver and driver names from these config keys.

### Open questions
- How the config type is registered (`typeof configs` reaching `config()`) → [#152](https://github.com/Laratypes/Laratype/issues/152)

### Acceptance
[#152 Done when](https://github.com/Laratypes/Laratype/issues/152)

---

## Environment validation

### Status
planned → [#152](https://github.com/Laratypes/Laratype/issues/152) (K1, M3).

### Design (non-binding)
- **Schema:** `defineEnv(z.object(...))`, in `@laratype/core`.
- **Boot:** the environment is validated at boot, and boot fails on an invalid environment.

### Open questions
- Where `defineEnv` is called (which file) → [#152](https://github.com/Laratypes/Laratype/issues/152)
- The error output on an invalid environment → [#152](https://github.com/Laratypes/Laratype/issues/152)

### Acceptance
[#152 Done when](https://github.com/Laratypes/Laratype/issues/152)
