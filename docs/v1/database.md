---
area: database
packages: ["@laratype/database"]
issues: [88, 145, 146, 147, 148, 149, 150]
verified-against: Laratype@256a743
last-verified: 2026-10-10
---

# Database, placeholder

> **Placeholder.** The v1 database API waits for the ORM decision, S5 [#88](https://github.com/Laratypes/Laratype/issues/88): Kysely, or keep TypeORM. Until S5 closes, each section's Design note only restates its issue's tasks. No section gains signatures before S5's ADR is posted. S5 also defines the minimal `BindableModel` interface (find by key, primary key metadata) that model binding needs ([http.md › Model binding](./http.md#model-binding)).

**State on master (0.5):** `@laratype/database` is built on TypeORM (`typeorm` `^0.3.20` in its `package.json`). It has an Eloquent-style `Model` in `packages/database/src/eloquent/Model.ts`, plus factories and seeders under `packages/database/src/factories` and `seeders`.

| Section | Status |
|---|---|
| [Model](#model) | planned → #145 (waits for #88) |
| [Fillable and hidden](#fillable-and-hidden) | planned → #146 (waits for #88) |
| [Relations and with()](#relations-and-with) | planned → #147 (waits for #88) |
| [Migrations and introspection](#migrations-and-introspection) | planned → #148 (waits for #88) |
| [Factories and seeders](#factories-and-seeders) | planned → #149 (waits for #88) |
| [TypeORM adapter](#typeorm-adapter) | planned → #150 (waits for #88) |

---

## Model

### Status
planned → [#145](https://github.com/Laratypes/Laratype/issues/145) (DB1, M3). Waits for S5 [#88](https://github.com/Laratypes/Laratype/issues/88).

### Design (non-binding)
From #145: an Eloquent-like Model on the chosen ORM: `User.query().where(...).paginate()`, `find`, `findOrFail`, primary key metadata.

### Acceptance
[#145 Done when](https://github.com/Laratypes/Laratype/issues/145)

---

## Fillable and hidden

### Status
planned → [#146](https://github.com/Laratypes/Laratype/issues/146) (DB2, M3). Waits for S5 [#88](https://github.com/Laratypes/Laratype/issues/88).

### Design (non-binding)
From #146: mass-assignment safety at the type level: `Model.create()` accepts only fillable keys, and `hidden` keys are removed from the serialized type.

### Acceptance
[#146 Done when](https://github.com/Laratypes/Laratype/issues/146)

---

## Relations and with()

### Status
planned → [#147](https://github.com/Laratypes/Laratype/issues/147) (DB3, M3). Waits for S5 [#88](https://github.com/Laratypes/Laratype/issues/88).

### Design (non-binding)
From #147: `hasOne`, `hasMany`, `belongsTo`, `belongsToMany`, and typed eager loading through `with()`.

### Acceptance
[#147 Done when](https://github.com/Laratypes/Laratype/issues/147)

---

## Migrations and introspection

### Status
planned → [#148](https://github.com/Laratypes/Laratype/issues/148) (DB4, M3). Waits for S5 [#88](https://github.com/Laratypes/Laratype/issues/88).

### Design (non-binding)
From #148: a migration runner, and `sauf db:introspect`, which generates the `Database` interface that types the schema ([cli.md › Command list](./cli.md#command-list)). Other work waits for it: the queue's database driver ([services.md › Queue](./services.md#queue)), the `job_batches` table ([services.md › Job chains and batches](./services.md#job-chains-and-batches)), and the `oauth_*` tables of the OAuth2 server ([#179](https://github.com/Laratypes/Laratype/issues/179)).

### Acceptance
[#148 Done when](https://github.com/Laratypes/Laratype/issues/148)

---

## Factories and seeders

### Status
planned → [#149](https://github.com/Laratypes/Laratype/issues/149) (DB5, M3). Waits for S5 [#88](https://github.com/Laratypes/Laratype/issues/88).

### Design (non-binding)
From #149: port the current factory and seeder API (`packages/database/src/factories`, `seeders`) onto the v1 Model. `sauf db:seed` runs on `examples/basic` ([cli.md › Command list](./cli.md#command-list)).

### Acceptance
[#149 Done when](https://github.com/Laratypes/Laratype/issues/149)

---

## TypeORM adapter

### Status
planned → [#150](https://github.com/Laratypes/Laratype/issues/150) (DB6, M3). Waits for S5 [#88](https://github.com/Laratypes/Laratype/issues/88).

### Design (non-binding)
From #150: an adapter that implements `BindableModel` and the Model API over TypeORM entities, so 0.5 apps can upgrade gradually.

### Acceptance
[#150 Done when](https://github.com/Laratypes/Laratype/issues/150)
