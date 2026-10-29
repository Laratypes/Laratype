---
area: database
packages: ["@laratype/database"]
issues: [88, 118, 145, 146, 147, 148, 149, 150, 163]
verified-against: Laratype@256a743
last-verified: 2026-10-10
---

# Database, placeholder

> **Placeholder.** **TypeORM chosen (S5 [#88](https://github.com/Laratypes/Laratype/issues/88)).** Step 1 is the `BindableModel` interface in [BindableModel](#bindablemodel) below ([#347](https://github.com/Laratypes/Laratype/pull/347)); it names no ORM. Step 2, the ADR, keeps TypeORM: the 0.5 `Model`, factories and seeders are TypeORM, DB4's migrations run on its `DataSource`, and the alternative typed query builder is not adopted. The other sections stay planned; their Design notes are non-binding and gain no signatures before their code lands.

**State on master (0.5):** `@laratype/database` is built on TypeORM (`typeorm` `^0.3.20` in its `package.json`). It has an Eloquent-style `Model` in `packages/database/src/eloquent/Model.ts`, plus factories and seeders under `packages/database/src/factories` and `seeders`.

| Section | Status |
|---|---|
| [BindableModel](#bindablemodel) | agreed in PR [#347](https://github.com/Laratypes/Laratype/pull/347) (spec only, merged @ 1f35b7b; S5 #88 step 1); code → #118, #163 |
| [Model](#model) | planned → #145 |
| [Fillable and hidden](#fillable-and-hidden) | planned → #146 |
| [Relations and with()](#relations-and-with) | planned → #147 |
| [Migrations and introspection](#migrations-and-introspection) | planned → #148 |
| [Factories and seeders](#factories-and-seeders) | planned → #149 |
| [TypeORM adapter](#typeorm-adapter) | planned → #150 |

---

## BindableModel

### Status
agreed in PR [#347](https://github.com/Laratypes/Laratype/pull/347) (spec only, merged @ 1f35b7b); no code yet. The code lands with [#118](https://github.com/Laratypes/Laratype/issues/118) (H7), and [#163](https://github.com/Laratypes/Laratype/issues/163) (H14) uses it. The interface is agreed in S5 [#88](https://github.com/Laratypes/Laratype/issues/88) step 1 (the user's 2026-10-10 two-step decision on the ORM). H14 binds models through the same interface; S5 step 2 keeps TypeORM ([S5 decision](./overview.md#decision-log)), so H14 no longer waits for it.

### Public API
Type-only, exported by `@laratype/database`. It describes the **static side** of a model class, because `.bind({ user: User })` passes the class.

```ts
interface BindableModel<M extends object = object> {
  new (...args: any[]): M;
  readonly primaryKey: string;                                   // the property `routeKeyName` defaults to
  readonly routeKeyName?: string;                                // the property a route param looks the model up by
  findByRouteKey(key: string): Promise<M | null | undefined>;    // null / undefined on a miss: H7 answers 404
}
```

`@laratype/http` types `.bind()` against the same structural shape and does not import it, so it gains no dependency on `@laratype/database`.

### Invariants
- **Static side, not instance side.** Every member is a static of the model class: `.bind({ user: User })` passes the class, and the lookup is `User.findByRouteKey(...)`. The interface constrains no instance member, so the bound value keeps the class's own instance type (`InstanceType<C>` in the binder types), with its columns and methods unchanged. `class User implements BindableModel` does not apply, since `implements` checks the instance side; the class is checked where `.bind()` takes it.
- **The lookup.** `findByRouteKey(key)` returns the instance whose route key property equals `key`, or `null` / `undefined` on a miss. H7 turns both into a 404.
- **Route key.** `routeKeyName` defaults to `primaryKey`. Both are model property names (the names the lookup filters on), not database column names. H14 reads the same static for the implicit lookup property ([http.md › Model binding](./http.md#model-binding)).
- **Key conversion.** The router passes the raw path param string, and the model converts it to the type of its route key property (a numeric id, a UUID) inside `findByRouteKey`: the router never parses a route key, since it does not know the property's type.
- **Bound value types.** A class binder constrains the class with `BindableModel` (its default `M = object`) and gives `InstanceType<C>` of the class it is passed, not the return type of `findByRouteKey`: a `findByRouteKey` inherited from a base class returns the base type, so a `BindableModel<InstanceType<C>>` constraint would refuse every subclass (TS2345). A resolver gives `NonNullable<Awaited<ReturnType>>`, because a miss is a 404; an optional path param (`:post?`) gives `Post | undefined` when absent, while a present one with no match is a 404 ([http.md › Route proof at r.contract()](./http.md#route-proof-at-rcontract)).
- **No ORM.** The interface has no query builder, repository, entity manager or connection member, so it is satisfied without picking the ORM. On TypeORM, the statics go on the base `Model` (DB1 [#145](https://github.com/Laratypes/Laratype/issues/145)): `primaryKey` reads `getRepository().metadata.primaryColumns[0].propertyName` (what `ModelManagement.getPrimaryKeyFromModel` does today), and `findByRouteKey` runs `this.findOne({ where: { [this.routeKeyName ?? this.primaryKey]: key } })`.
- **Structural.** Any class with those three statics fits, with no `implements` clause and no import of `BindableModel`.

### Diagnostics
None yet: the code lands with H7, which defines the 404 body and the compile-time message for a class that does not satisfy the interface ([http.md › Model binding](./http.md#model-binding)).

### Example
Planned shape (illustrative, not compiled): the statics on the TypeORM base `Model` make every model bindable.

```ts
class Model {
  static readonly primaryKey: string                 // getRepository().metadata.primaryColumns[0].propertyName
  static readonly routeKeyName?: string              // `primaryKey` when unset
  static findByRouteKey(key: string) {
    return this.findOne({ where: { [this.routeKeyName ?? this.primaryKey]: key } })
  }
}

class User extends Model { declare readonly id: number; declare readonly email: string }

class Post extends Model {
  declare readonly slug: string
  static override readonly routeKeyName = 'slug'     // `/posts/:post` looks posts up by slug
}

r.bind({ user: User, post: Post })   // ctx.params.user: User, ctx.params.post: Post; a miss is a 404
```

### Non-goals
- No query builder, relations, create/save/update or serialization: DB1–DB6, and model serialization in the queue (Q1 [#169](https://github.com/Laratypes/Laratype/issues/169)).
- No ORM choice, migrations or transactions: the S5 ADR, and DB4 [#148](https://github.com/Laratypes/Laratype/issues/148).
- No registry or route scanning: H14 [#163](https://github.com/Laratypes/Laratype/issues/163) generates `Register['models']` and calls the same lookup.
- No composite primary key: `primaryKey` is one property and the default route key, so a model with a composite key sets `routeKeyName` to the one property to look up by.

### Open questions
- A route key that cannot convert to the primary key type (a non-numeric value for a numeric id): a miss (404) or a malformed request (422)? → [#118](https://github.com/Laratypes/Laratype/issues/118)
- Resolved: how a non-TypeORM model reaches its database handle from the static `findByRouteKey` is moot, since S5 step 2 keeps TypeORM ([#88](https://github.com/Laratypes/Laratype/issues/88)).

### Acceptance
[#88 Done when](https://github.com/Laratypes/Laratype/issues/88) (the interface) · [#118 Done when](https://github.com/Laratypes/Laratype/issues/118) (the code)

---

## Model

### Status
planned → [#145](https://github.com/Laratypes/Laratype/issues/145) (DB1, M3).

### Design (non-binding)
From #145: an Eloquent-like `Model` on TypeORM: `User.query().where(...).paginate()`, `find`, `findOrFail`, primary key metadata. The type safety a typed query builder would give stays in that typed surface (`query().where(...).paginate()`, `find`, `findOrFail`), since TypeORM's own query builder types the entity, not each column. Primary key metadata reads `getRepository().metadata.primaryColumns[0].propertyName`, as `ModelManagement` does in 0.5.

### Acceptance
[#145 Done when](https://github.com/Laratypes/Laratype/issues/145)

---

## Fillable and hidden

### Status
planned → [#146](https://github.com/Laratypes/Laratype/issues/146) (DB2, M3).

### Design (non-binding)
From #146: mass-assignment safety at the type level on the TypeORM entity: `Model.create()` accepts only fillable keys, and `hidden` keys are removed from the serialized type. `fillable` and `hidden` are model statics layered over the entity, not TypeORM column options; `hidden` is a type-level removal for the wire and resource types.

### Acceptance
[#146 Done when](https://github.com/Laratypes/Laratype/issues/146)

---

## Relations and with()

### Status
planned → [#147](https://github.com/Laratypes/Laratype/issues/147) (DB3, M3).

### Design (non-binding)
From #147: `hasOne`, `hasMany`, `belongsTo`, `belongsToMany`, and typed eager loading through `with()`, on TypeORM's relation metadata and `relations` find options. The relation names and their target model types come from the entity's relation properties, so `with()` types the loaded relations.

### Acceptance
[#147 Done when](https://github.com/Laratypes/Laratype/issues/147)

---

## Migrations and introspection

### Status
planned → [#148](https://github.com/Laratypes/Laratype/issues/148) (DB4, M3).

### Design (non-binding)
From #148: a migration runner over TypeORM migrations (`MigrationInterface` and `DataSource.runMigrations`), transactions through the same `DataSource`, and `sauf db:introspect`, which reads the DataSource metadata and generates the `Database` interface that types the schema ([cli.md › Command list](./cli.md#command-list)). Other work waits for it: the queue's database driver ([services.md › Queue](./services.md#queue)), the `job_batches` table ([services.md › Job chains and batches](./services.md#job-chains-and-batches)), and the `oauth_*` tables of the OAuth2 server ([#179](https://github.com/Laratypes/Laratype/issues/179)).

### Acceptance
[#148 Done when](https://github.com/Laratypes/Laratype/issues/148)

---

## Factories and seeders

### Status
planned → [#149](https://github.com/Laratypes/Laratype/issues/149) (DB5, M3).

### Design (non-binding)
From #149: port the current factory and seeder API (`packages/database/src/factories`, `seeders`) onto the v1 Model. The 0.5 `Factory` already builds `DeepPartial` definitions over TypeORM entities and saves them through the model, so the port keeps the `definition()` / `state()` / relation wiring. `sauf db:seed` runs on `examples/basic` ([cli.md › Command list](./cli.md#command-list)).

### Acceptance
[#149 Done when](https://github.com/Laratypes/Laratype/issues/149)

---

## TypeORM adapter

### Status
planned → [#150](https://github.com/Laratypes/Laratype/issues/150) (DB6, M3). Depends on DB1 [#145](https://github.com/Laratypes/Laratype/issues/145) and D7 [#114](https://github.com/Laratypes/Laratype/issues/114).

### Design (non-binding)
From #150 (rescoped after S5): with TypeORM kept, the Model API over TypeORM entities is DB1's `Model` itself, so DB6 covers what lets 0.5 apps upgrade gradually:
- **`DataSource` in the container:** a singleton built from typed config (K1) and the manifest's entities, used by DB1, DB4, DB5, the queue driver and auth. A failed connection fails boot with the driver's message (secrets redacted), instead of only being logged until the `DS` proxy throws `DataSourceNotInitYet`.
- **0.5 compatibility:** `ModelManagement`, `Route.model` and the 0.5 `Model` statics keep working on DB1's `Model` and that binding.
- Out of scope: removing `globalThis.__laratype_db` and `__laratype_param_model_map` is D7 [#114](https://github.com/Laratypes/Laratype/issues/114); DB6 builds on the bindings D7 adds.

### Acceptance
[#150 Done when](https://github.com/Laratypes/Laratype/issues/150)
