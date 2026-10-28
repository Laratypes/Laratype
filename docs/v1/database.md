---
area: database
packages: ["@laratype/database"]
issues: [88, 118, 145, 146, 147, 148, 149, 150, 163]
verified-against: Laratype@256a743
last-verified: 2026-10-10
---

# Database, placeholder

> **Placeholder.** S5 [#88](https://github.com/Laratypes/Laratype/issues/88) runs in two steps: the `BindableModel` interface that both options satisfy, then an ADR that picks the ORM. Step 1 is specified in [BindableModel](#bindablemodel) below; the ADR (step 2) is still pending. Until it lands, each other section's Design note only restates its issue's tasks, and none of them gains signatures. The interface is what model binding needs ([http.md › Model binding](./http.md#model-binding)), and it names no ORM, so it does not wait for the ADR.

**State on master (0.5):** `@laratype/database` is built on TypeORM (`typeorm` `^0.3.20` in its `package.json`). It has an Eloquent-style `Model` in `packages/database/src/eloquent/Model.ts`, plus factories and seeders under `packages/database/src/factories` and `seeders`.

| Section | Status |
|---|---|
| [BindableModel](#bindablemodel) | planned → #118, #163 (S5 #88 step 1) |
| [Model](#model) | planned → #145 (waits for #88) |
| [Fillable and hidden](#fillable-and-hidden) | planned → #146 (waits for #88) |
| [Relations and with()](#relations-and-with) | planned → #147 (waits for #88) |
| [Migrations and introspection](#migrations-and-introspection) | planned → #148 (waits for #88) |
| [Factories and seeders](#factories-and-seeders) | planned → #149 (waits for #88) |
| [TypeORM adapter](#typeorm-adapter) | planned → #150 (waits for #88) |

---

## BindableModel

### Status
planned → [#118](https://github.com/Laratypes/Laratype/issues/118) (H7), [#163](https://github.com/Laratypes/Laratype/issues/163) (H14). The interface is agreed in S5 [#88](https://github.com/Laratypes/Laratype/issues/88) step 1 (the user's 2026-10-10 two-step decision on the ORM), so these signatures are the agreed contract, not placeholders. The code that implements them lands with H7, and H14 binds models through the same interface; the ORM ADR is step 2 and still pending.

### Design (agreed in S5 #88 step 1)
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
- **Static side, not instance side.** Every member is a static of the model class: `.bind({ user: User })` passes the class, and the lookup is `User.findByRouteKey(...)`. The interface constrains no instance member, so the bound value keeps the class's own instance type (`InstanceType<M>` in the binder types), with its columns and methods unchanged. `class User implements BindableModel` does not apply, since `implements` checks the instance side; the class is checked where `.bind()` takes it.
- **The lookup.** `findByRouteKey(key)` returns the instance whose route key property equals `key`, or `null` / `undefined` on a miss. H7 turns both into a 404.
- **Route key.** `routeKeyName` defaults to `primaryKey`. Both are model property names (the names the lookup filters on), not database column names. H14 reads the same static for the implicit lookup property ([http.md › Model binding](./http.md#model-binding)).
- **Key conversion.** The router passes the raw path param string, and the model converts it to the type of its route key property (a numeric id, a UUID) inside `findByRouteKey`: the router never parses a route key, since it does not know the property's type.
- **Bound value types.** A class binder gives `InstanceType<M>`; a resolver gives `NonNullable<Awaited<ReturnType>>`, because a miss is a 404; an optional path param (`:post?`) gives `Post | undefined` when absent, while a present one with no match is a 404 ([http.md › Route proof at r.contract()](./http.md#route-proof-at-rcontract)).
- **No ORM.** The interface has no query builder, repository, entity manager or connection member, so it is satisfied without picking the ORM. On 0.5 TypeORM, the statics go on the base (or on DB6 [#150](https://github.com/Laratypes/Laratype/issues/150)'s adapter): `primaryKey` reads `getRepository().metadata.primaryColumns[0].propertyName` (what `ModelManagement.getPrimaryKeyFromModel` does today), and `findByRouteKey` runs `this.findOne({ where: { [this.routeKeyName ?? this.primaryKey]: key } })`. A Kysely model provides the same three statics, with its own single-column lookup.
- **Structural.** Any class with those three statics fits, with no `implements` clause and no import of `BindableModel`.

### Diagnostics
None yet: the code lands with H7, which defines the 404 body and the compile-time message for a class that does not satisfy the interface ([http.md › Model binding](./http.md#model-binding)).

### Example
Planned shape (illustrative, not compiled): the statics on the 0.5 TypeORM base, or in DB6's adapter, make every model bindable.

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
  static readonly routeKeyName = 'slug'              // `/posts/:post` looks posts up by slug
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
- How a Kysely model reaches its database handle from the static `findByRouteKey` → [#145](https://github.com/Laratypes/Laratype/issues/145)

### Acceptance
[#88 Done when](https://github.com/Laratypes/Laratype/issues/88) (the interface) · [#118 Done when](https://github.com/Laratypes/Laratype/issues/118) (the code)

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
