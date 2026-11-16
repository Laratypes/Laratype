---
area: database
packages: ["@laratype/database"]
issues: [88, 118, 145, 146, 147, 148, 149, 150, 163]
verified-against: Laratype@HEAD
last-verified: 2026-11-16
---

# Database

> **TypeORM chosen (S5 [#88](https://github.com/Laratypes/Laratype/issues/88)).** Step 1 is the `BindableModel` interface in [BindableModel](#bindablemodel) below ([#347](https://github.com/Laratypes/Laratype/pull/347)); it names no ORM. Step 2, the ADR, keeps TypeORM: the 0.5 `Model`, factories and seeders are TypeORM, DB4's migrations run on its `DataSource`, and the alternative typed query builder is not adopted. [Model](#model) is proposed by DB1 [#145](https://github.com/Laratypes/Laratype/issues/145); the other sections stay planned, and their Design notes are non-binding.

**State on master (0.5):** `@laratype/database` is built on TypeORM (`typeorm` `^0.3.20` in its `package.json`). It has an Eloquent-style `Model` in `packages/database/src/eloquent/Model.ts`, plus factories and seeders under `packages/database/src/factories` and `seeders`.

| Section | Status |
|---|---|
| [BindableModel](#bindablemodel) | merged @ 1f35b7b (spec only, PR [#347](https://github.com/Laratypes/Laratype/pull/347), S5 #88 step 1); the TypeORM statics land in [Model](#model), the interface type and the binder → #118, #163 |
| [Model](#model) | proposed: PR <leader fills> @ <sha> → #145 |
| [Fillable and hidden](#fillable-and-hidden) | planned → #146 |
| [Relations and with()](#relations-and-with) | planned → #147 |
| [Migrations and introspection](#migrations-and-introspection) | planned → #148 |
| [Factories and seeders](#factories-and-seeders) | planned → #149 |
| [TypeORM adapter](#typeorm-adapter) | planned → #150 |

---

## BindableModel

### Status
merged @ 1f35b7b

Spec only, from PR [#347](https://github.com/Laratypes/Laratype/pull/347). The TypeORM statics it describes are on the base `Model` from DB1 [#145](https://github.com/Laratypes/Laratype/issues/145) ([Model](#model)); the interface type itself and the binder land with [#118](https://github.com/Laratypes/Laratype/issues/118) (H7), and [#163](https://github.com/Laratypes/Laratype/issues/163) (H14) uses it. The interface is agreed in S5 [#88](https://github.com/Laratypes/Laratype/issues/88) step 1 (the user's 2026-10-10 two-step decision on the ORM). H14 binds models through the same interface; S5 step 2 keeps TypeORM ([S5 decision](./overview.md#decision-log)), so H14 no longer waits for it.

### Public API
Type-only; H7 [#118](https://github.com/Laratypes/Laratype/issues/118) exports it from `@laratype/database`, and DB1 does not add the type (the base `Model` satisfies it structurally). It describes the **static side** of a model class, because `.bind({ user: User })` passes the class.

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
- **No ORM.** The interface has no query builder, repository, entity manager or connection member, so it is satisfied without picking the ORM. On TypeORM, the statics are on the base `Model` (DB1 [#145](https://github.com/Laratypes/Laratype/issues/145)): `primaryKey` reads `getRepository().metadata.primaryColumns[0].propertyName` (what `ModelManagement.getPrimaryKeyFromModel` does today), and `findByRouteKey` converts `key` to the route key property's type (the Key conversion rule above and [Model › Invariants](#invariants-1)), then runs `this.findOne({ where: { [this.routeKeyName ?? this.primaryKey]: converted } })`. A key that cannot convert is a miss (`null`), never a throw.
- **Structural.** Any class with those three statics fits, with no `implements` clause and no import of `BindableModel`.

### Diagnostics
The model statics' errors are in [Model › Diagnostics](#diagnostics-1). The binder's 404 body and the compile-time message for a class that does not satisfy the interface are H7's ([http.md › Model binding](./http.md#model-binding)).

### Example
Illustrative (not compiled): the statics on the TypeORM base `Model` make every model bindable, as [Model](#model) implements them.

```ts
class Model {
  static readonly primaryKey: string                 // getRepository().metadata.primaryColumns[0].propertyName
  static readonly routeKeyName?: string              // `primaryKey` when unset
  static findByRouteKey(key: string) {
    // converts `key` to the route key property's type first (Invariants › Key conversion), then
    // runs this.findOne({ where: { [this.routeKeyName ?? this.primaryKey]: converted } })
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
- No composite primary key: [Model](#model) refuses one (`primaryKey`, `find` and `findOrFail`), so a model with a composite key sets `routeKeyName` to the one property to look up by and queries with `query().where(...)`.

### Open questions
- Resolved for the model: a route key that cannot convert to the primary key type is a miss, `findByRouteKey()` returns `null` (DB1 [#145](https://github.com/Laratypes/Laratype/issues/145)). Whether the binder answers 404 or 422 for it stays [#118](https://github.com/Laratypes/Laratype/issues/118).
- Resolved: how a non-TypeORM model reaches its database handle from the static `findByRouteKey` is moot, since S5 step 2 keeps TypeORM ([#88](https://github.com/Laratypes/Laratype/issues/88)).

### Acceptance
[#88 Done when](https://github.com/Laratypes/Laratype/issues/88) (the interface) · [#118 Done when](https://github.com/Laratypes/Laratype/issues/118) (the code)

---

## Model

### Status
proposed: PR <leader fills> @ <sha> → [#145](https://github.com/Laratypes/Laratype/issues/145) (DB1, M3). TypeORM stays (S5 [#88](https://github.com/Laratypes/Laratype/issues/88), PR [#354](https://github.com/Laratypes/Laratype/pull/354)); the 0.5 `Model` and its password rules (PR [#346](https://github.com/Laratypes/Laratype/pull/346)) are kept, and this section adds the typed query surface and [BindableModel](#bindablemodel)'s statics.

### Public API
[`Model.ts`](https://github.com/Laratypes/Laratype/blob/<sha>/packages/database/src/eloquent/Model.ts) · [`ModelQueryBuilder.ts`](https://github.com/Laratypes/Laratype/blob/<sha>/packages/database/src/eloquent/ModelQueryBuilder.ts) · [`ModelError.ts`](https://github.com/Laratypes/Laratype/blob/<sha>/packages/database/src/exceptions/ModelError.ts) · [`ModelNotFoundException.ts`](https://github.com/Laratypes/Laratype/blob/<sha>/packages/database/src/exceptions/ModelNotFoundException.ts). The 0.5 `Model` keeps every member it has (`extends BaseEntity`, `fillable`, `passwordField`, `save`, `update`, `updateFor`, `findOneBy`); the list below is what this section adds.

```ts
class Model extends BaseEntity {
  static get primaryKey(): string;
  static readonly routeKeyName: string | undefined;                           // primaryKey when unset
  static query<T extends BaseEntity>(this: { new (): T } & typeof BaseEntity): ModelQueryBuilder<T>;
  /** @deprecated */
  static query<T extends BaseEntity>(this: { new (): T } & typeof BaseEntity, sql: string, parameters?: readonly unknown[]): Promise<unknown>;
  static find<T extends BaseEntity>(this: { new (): T } & typeof BaseEntity, id: PrimaryKeyValue): Promise<T | null>;
  static find<T extends BaseEntity>(this: { new (): T } & typeof BaseEntity, options?: FindManyOptions<T>): Promise<T[]>;   // 0.5 list form
  static findOrFail<T extends BaseEntity>(this: { new (): T } & typeof BaseEntity, id: PrimaryKeyValue): Promise<T>;
  static findByRouteKey<T extends BaseEntity>(this: { new (): T } & typeof BaseEntity, key: string): Promise<T | null>;
  getRouteKey(): string | number | bigint;
}

type PrimaryKeyValue = string | number | bigint;

type ColumnKey<T> = {
  [K in Extract<keyof T, string>]: T[K] extends (...args: any[]) => any ? never : K;
}[Extract<keyof T, string>];
type ModelWhere<T> = { [K in ColumnKey<T>]?: Exclude<T[K], undefined> };
type WhereComparison = "=" | "!=" | "<" | "<=" | ">" | ">=" | "like" | "not like";
type WhereOperator = WhereComparison | "in" | "not in";
type OrderDirection = "asc" | "desc";

interface Page<T> {
  readonly data: T[];
  readonly total: number;
  readonly perPage: number;
  readonly currentPage: number;
  readonly lastPage: number;
}

class ModelQueryBuilder<T extends object = object> {
  constructor(repository: Repository<T>);                                    // Model.query() builds it
  where<K extends ColumnKey<T>>(column: K, value: Exclude<T[K], undefined>): this;
  where<K extends ColumnKey<T>>(column: K, operator: "in" | "not in", value: readonly Exclude<T[K], undefined>[]): this;
  where<K extends ColumnKey<T>>(column: K, operator: WhereComparison, value: Exclude<T[K], undefined>): this;
  where(where: ModelWhere<T>): this;
  orderBy<K extends ColumnKey<T>>(column: K, direction?: OrderDirection): this;
  limit(count: number): this;
  first(): Promise<T | null>;
  get(): Promise<T[]>;
  paginate(page?: number, perPage?: number): Promise<Page<T>>;
}

class ModelError extends Error { name: "ModelError" }                          // key metadata, column, argument errors
class ModelNotFoundException extends NotFoundException { name: "ModelNotFoundException" }   // findOrFail
```

### Invariants
- **The 0.5 base is kept, with no breaking change.** `Model` stays the published class (`extends TypeORM`'s `BaseEntity`), so `ModelManagement`, `Route.model`, `UseModel`, factories and seeders keep working on it. `find` and `query` gain overloads around their 0.5 meanings: `User.find()` / `User.find(options)` still list (TypeORM's form), and `User.query("SELECT ...")` still runs raw SQL; `find(id)` and `query()` are new. `examples/basic`'s `User.find()` keeps compiling. The raw `query(sql, parameters)` overload is deprecated in favour of `getRepository().query(...)`.
- **The #346 password rules stay, exactly where they are.** They live in `packages/database/src/eloquent/Model.ts` and their tests are unchanged:
  - The credential column comes from `static passwordField` (`password` by default): `save()`, `update()` and `updateFor()` hash a plain value in it unless `Hash.isHashed()` accepts it, and `findOneBy()` refuses a where object that carries it.
  - Request input must be validated as a plain password before it reaches the model. `cast()` stores a value that `Hash.isHashed()` accepts as it is, so a client that submits a well-formed scrypt string as its password has it stored as the credential, the same bypass as Laravel's hashed cast.
- **One typed facade, not a second query builder.** `query()` wraps one TypeORM `SelectQueryBuilder` created from the model's repository; `where()` calls combine with AND in call order, `first()` is `getOne()`, `get()` is `getMany()`, and `paginate()` uses `getManyAndCount()` (TypeORM's count ignores the page window, so `total` is every match). `limit()` sets a LIMIT for `first()` / `get()`; `paginate()` replaces an earlier limit with its own page window.
- **Columns are typed and checked twice.** `ColumnKey<T>` keeps the entity's own string data keys and drops function-valued members, so `where("save", ...)` does not compile, and a symbol-keyed brand (A3 [#121](https://github.com/Laratypes/Laratype/issues/121)) is never a column. At runtime every column name in `where()`, `orderBy()` and `routeKeyName` is resolved with `metadata.findColumnWithPropertyName`: only an own column property name is accepted, an unknown name throws, and relation or embedded paths are refused until DB3 [#147](https://github.com/Laratypes/Laratype/issues/147). The caller's string is never interpolated: the metadata's `propertyName` is what TypeORM receives, `orderBy()` interpolates the metadata property into `${qb.alias}.${property}` with the query's own alias, and values travel as `FindOperator` parameters.
- **Operators, direction and limits are allowlisted.** The three-argument `where()` maps its operator to a TypeORM `FindOperator` (`=`, `!=`, `<`, `<=`, `>`, `>=`, `like`, `not like`, `in`, `not in`) through a closed switch; an operator outside the list throws, and `in` / `not in` require an array. `orderBy()` accepts `asc` / `desc` in any case at runtime. `limit()` takes a positive safe integer; `paginate()` takes `page >= 1` and `perPage` from 1 to 100 (the cap is 100, so a request cannot ask for an unbounded page), both safe integers, and their offset must stay a safe integer.
- **`paginate()` gives a plain page.** It resolves `{ data, total, perPage, currentPage, lastPage }` as one object literal: no class, no getters, `page` defaults to 1, `perPage` to 15, and `lastPage` is `max(1, ceil(total / perPage))`. http.md › Resources `paginate(page)` takes it as is (an object with an array `data` plus plain meta fields). #339 adds a refused-key check for page-level keys in the resource; `Page` has no own `toJSON` or `constructor` key, so it is unrelated to those names.
- **`find` / `findOrFail`.** A string, number or bigint argument is the primary key (`findOne({ where: { [primaryKey]: id } })`); no argument, `undefined` or an object keeps the 0.5 list form. `findOrFail` throws `ModelNotFoundException` instead of answering `null`.
- **A missing model is a 404 with a generic body.** `ModelNotFoundException extends @laratype/support`'s `NotFoundException` (a responsible `Exception`), so the existing exception filter answers 404 `{ code: "NOT_FOUND", message: "Resource not found!" }` with no change to `@laratype/http`. Its own `message` is `No query results for model [User] 42`, for logs and tests; `toJson()` keeps the model name and the key off the wire.
- **Primary key metadata.** `primaryKey` reads `getRepository().metadata.primaryColumns[0].propertyName` (the `ModelManagement.getPrimaryKeyFromModel` read). No primary column and a composite primary key both throw `ModelError`: `find` and `findOrFail` need one key. A composite-key model sets `static routeKeyName` to the one column a lookup uses and queries with `query().where(...)`.
- **The BindableModel statics.** `primaryKey`, `routeKeyName` (a model property name, `primaryKey` when unset) and `findByRouteKey(key)` satisfy [BindableModel](#bindablemodel) structurally; DB1 adds no `BindableModel` interface type (H7 [#118](https://github.com/Laratypes/Laratype/issues/118) owns it). `findByRouteKey` converts the raw path string by the route key column's metadata type:
  - a numeric column (the `Number` constructor and the integer / float / decimal column types) takes only a canonical integer string: optional `-`, no leading zero, no space, no exponent, no decimal point, and `String(Number(key)) === key` with a safe integer, so `01`, `1.0`, `1e3`, `+1`, `" 1"` and values above 2^53 are refused;
  - a `Date` column type takes what `new Date(key)` parses; an invalid date is refused;
  - a boolean column takes `true` / `1` and `false` / `0`;
  - every other column type (uuid, string, enum, and `bigint`, which keeps its precision) keeps the string as it is.
  A key that cannot convert is a miss (`null`), never a throw; a `routeKeyName` that is not a column is a configuration bug and throws.
- **`getRouteKey()`** (instance) returns `this[routeKeyName ?? primaryKey]`, typed `string | number | bigint`: H13 [#162](https://github.com/Laratypes/Laratype/issues/162)'s `route()` takes it as a path param, and H14 [#163](https://github.com/Laratypes/Laratype/issues/163) uses it. DB1 lands it on the model base.

### Diagnostics
The 0.5 `Model` that PR [#346](https://github.com/Laratypes/Laratype/pull/346) @ 74b7e8245a6f86832f6d048bb6a62ed79a33011e changes (`packages/database/src/eloquent/Model.ts`) throws, instead of matching a password in the query:
- `[@laratype/database] findOneBy() cannot look a user up by password: look the user up without it, then check the password with Hash.check()`

`ModelError` (`name = "ModelError"`):
- `[@laratype/database] <Model> has no primary key: mark one column with @PrimaryColumn or @PrimaryGeneratedColumn`
- `[@laratype/database] <Model> has a composite primary key (<property>, ...): the v1 Model needs one primary key, so set static routeKeyName to the property a lookup uses`
- `[@laratype/database] <Model>.routeKeyName "<name>" is not a column of the model`
- `[@laratype/database] <Model> has no column "<name>": where() takes a column property of the model`
- `[@laratype/database] <Model> has no column "<name>": orderBy() takes a column property of the model`
- `[@laratype/database] where() takes one of =, !=, <, <=, >, >=, like, not like, in, not in, got "<operator>"`
- `[@laratype/database] where() takes an array for "<in|not in>", got <value>`
- `[@laratype/database] where() takes a column name or a where object, got <value>`
- `[@laratype/database] orderBy() takes "asc" or "desc", got <value>`
- `[@laratype/database] limit() takes a positive safe integer, got <value>`
- `[@laratype/database] paginate() takes a page of 1 or more (a safe integer), got <value>`
- `[@laratype/database] paginate() takes a perPage of 1 to 100, got <value>`
- `[@laratype/database] paginate() takes a page and perPage whose offset is a safe integer, got page <page> and perPage <perPage>`

`ModelNotFoundException` (an `Exception`, so the HTTP filter answers 404):
- message (logs, tests): `No query results for model [<Model>] <key>`
- response body: `{ "code": "NOT_FOUND", "message": "Resource not found!" }`

TypeScript (representative; every refusal is at the `ColumnKey` / value type):
- `Argument of type '"nope"' is not assignable to parameter of type 'ColumnKey<User>'` (the two-argument `where()`, and a wrong value type).
- `No overload matches this call` for the three-argument `where()` / a bad operator or `in` operand; the listed signatures name the column and its value type.
- Object keys, `orderBy` directions and `find` / `findOrFail` keys are checked by their parameter types; a symbol key is not a `ColumnKey`.

### Example
```ts
class User extends Model {
  declare readonly id: number;
  declare readonly email: string;
  declare readonly isActive: boolean;
  declare readonly createdAt: Date;
}

const page = await User.query()
  .where("isActive", true)
  .where("createdAt", ">=", new Date("2026-01-01"))
  .orderBy("createdAt", "desc")
  .paginate(1, 15);
// { data: User[], total, perPage: 15, currentPage: 1, lastPage } — UserResource.paginate(page) takes it as is

const user = await User.find(1);                 // User | null
const required = await User.findOrFail(1);       // User, or a 404
const bound = await User.findByRouteKey("1");    // User | null: H7 answers a miss with 404

class Post extends Model {
  declare readonly slug: string;
  static override readonly routeKeyName = "slug";   // /posts/:post looks posts up by slug
}
const post = await Post.findByRouteKey("hello");    // Post | null
```
Tests: [`packages/database/__tests__/Model.statics.test.ts`](../../packages/database/__tests__/Model.statics.test.ts), [`ModelQueryBuilder.test.ts`](../../packages/database/__tests__/ModelQueryBuilder.test.ts) and the type tests [`ModelQueryBuilder.test-d.ts`](../../packages/database/__tests__/ModelQueryBuilder.test-d.ts). The runtime tests stub the repository and the `SelectQueryBuilder` over arrays in memory, as the 0.5 `Model.test.ts` does: no database driver is a dependency.

### Non-goals
- No fillable / hidden masking (DB2 [#146](https://github.com/Laratypes/Laratype/issues/146)), relations or `with()` (DB3 [#147](https://github.com/Laratypes/Laratype/issues/147)), migrations (DB4 [#148](https://github.com/Laratypes/Laratype/issues/148)), factories and seeders (DB5 [#149](https://github.com/Laratypes/Laratype/issues/149)) or the container `DataSource` (DB6 [#150](https://github.com/Laratypes/Laratype/issues/150)).
- No relation filters, embedded paths, composite keys, cursor pagination, aggregates (`count`, `sum`, ...), soft-delete helpers, a paginator class or page URLs / links.
- No HTTP code: the binding, its 404 / 422 choice and the implicit lookup are H7 [#118](https://github.com/Laratypes/Laratype/issues/118) and H14 [#163](https://github.com/Laratypes/Laratype/issues/163).
- No second query builder: TypeORM's `SelectQueryBuilder` stays the only one, and the facade exposes no raw SQL / where string.

### Open questions
- None recorded.

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
