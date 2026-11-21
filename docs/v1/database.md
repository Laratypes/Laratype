---
area: database
packages: ["@laratype/database"]
issues: [88, 118, 145, 146, 147, 148, 149, 150, 163]
verified-against: Laratype@ca6936b8
last-verified: 2026-11-19
---

# Database

> **TypeORM chosen (S5 [#88](https://github.com/Laratypes/Laratype/issues/88)).** Step 1 is the `BindableModel` interface in [BindableModel](#bindablemodel) below ([#347](https://github.com/Laratypes/Laratype/pull/347)); it names no ORM. Step 2, the ADR, keeps TypeORM: the 0.5 `Model`, factories and seeders are TypeORM, DB4's migrations run on its `DataSource`, and the alternative typed query builder is not adopted. [Model](#model) is proposed by DB1 [#145](https://github.com/Laratypes/Laratype/issues/145); the other sections stay planned, and their Design notes are non-binding.

**State on master (0.5):** `@laratype/database` is built on TypeORM (`typeorm` `^0.3.20` in its `package.json`). It has an Eloquent-style `Model` in `packages/database/src/eloquent/Model.ts`, plus factories and seeders under `packages/database/src/factories` and `seeders`.

| Section | Status |
|---|---|
| [BindableModel](#bindablemodel) | merged @ 1f35b7b (spec only, PR [#347](https://github.com/Laratypes/Laratype/pull/347), S5 #88 step 1); the TypeORM statics land in [Model](#model), the interface type and the binder → #118, #163 |
| [Model](#model) | proposed: PR [#395](https://github.com/Laratypes/Laratype/pull/395) @ ca6936b8 → #145 |
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
- **Key conversion.** The router passes the raw path param string, and the model converts it to the type of its route key property (a numeric id, a UUID) inside `findByRouteKey`: the router never parses a route key, since it does not know the property's type. A column transformer's `to` runs once on the path string, its result is checked against the column's type, and a throw is a miss, never an error surfaced to the request. A time-only key must match the time representation the driver hydrates, so a malformed time is a miss too.
- **Bound value types.** A class binder constrains the class with `BindableModel` (its default `M = object`) and gives `InstanceType<C>` of the class it is passed, not the return type of `findByRouteKey`: a `findByRouteKey` inherited from a base class returns the base type, so a `BindableModel<InstanceType<C>>` constraint would refuse every subclass (TS2345). A resolver gives `NonNullable<Awaited<ReturnType>>`, because a miss is a 404; an optional path param (`:post?`) gives `Post | undefined` when absent, while a present one with no match is a 404 ([http.md › Route proof at r.contract()](./http.md#route-proof-at-rcontract)).
- **No ORM.** The interface has no query builder, repository, entity manager or connection member, so it is satisfied without picking the ORM. On TypeORM, the statics are on the base `Model` (DB1 [#145](https://github.com/Laratypes/Laratype/issues/145)): `primaryKey` reads `getRepository().metadata.primaryColumns[0].propertyName` (what `ModelManagement.getPrimaryKeyFromModel` does today), and `findByRouteKey` converts `key` to the route key property's type (or through the column's transformer once; the Key conversion rule above and [Model › Invariants](#invariants-1)), checks a transformed value against the column's type, then runs the lookup through `findOne` with the converted value as a bound parameter, so eager relations and the single row match a plain key. A key that cannot convert, a transformed value that fails the type check and a `transformer.to` that throws are misses (`null`), never throws; a `routeKeyName` that is not a column, or an untransformed float / decimal column, is a configuration error and throws.
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
    // runs the lookup with the converted value as a bound parameter
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
- Resolved: a key that cannot convert to the route key property's type is a miss, and `findByRouteKey()` returns `null` ([#145](https://github.com/Laratypes/Laratype/issues/145)); [#118](https://github.com/Laratypes/Laratype/issues/118) decides the binding's status for that miss.
- Resolved: how a non-TypeORM model reaches its database handle from the static `findByRouteKey` is moot, since S5 step 2 keeps TypeORM ([#88](https://github.com/Laratypes/Laratype/issues/88)).

### Acceptance
[#88 Done when](https://github.com/Laratypes/Laratype/issues/88) (the interface) · [#118 Done when](https://github.com/Laratypes/Laratype/issues/118) (the code)

---

## Model

### Status
proposed: PR [#395](https://github.com/Laratypes/Laratype/pull/395) @ ca6936b8 → [#145](https://github.com/Laratypes/Laratype/issues/145) (DB1, M3). TypeORM stays (S5 [#88](https://github.com/Laratypes/Laratype/issues/88), PR [#354](https://github.com/Laratypes/Laratype/pull/354)); the 0.5 `Model` and its password rules (PR [#346](https://github.com/Laratypes/Laratype/pull/346)) are kept, and this section adds the typed query surface and [BindableModel](#bindablemodel)'s statics.

### Public API
[`Model.ts`](https://github.com/Laratypes/Laratype/blob/ca6936b8/packages/database/src/eloquent/Model.ts) · [`ModelQueryBuilder.ts`](https://github.com/Laratypes/Laratype/blob/ca6936b8/packages/database/src/eloquent/ModelQueryBuilder.ts) · [`ModelError.ts`](https://github.com/Laratypes/Laratype/blob/ca6936b8/packages/database/src/exceptions/ModelError.ts) · [`ModelNotFoundException.ts`](https://github.com/Laratypes/Laratype/blob/ca6936b8/packages/database/src/exceptions/ModelNotFoundException.ts). The 0.5 `Model` keeps every member it has (`extends BaseEntity`, `fillable`, `passwordField`, `save`, `update`, `updateFor`, `findOneBy`); the list below is what this section adds.

```ts
class Model extends BaseEntity {
  static get primaryKey(): string;
  static readonly routeKeyName: string | undefined;                           // primaryKey when unset
  static query<T extends BaseEntity>(this: ModelClass<T>): ModelQueryBuilder<T>;
  /** @deprecated raw 0.5 form; it keeps TypeORM's `any` return */
  static query<T extends BaseEntity>(this: ModelClass<T>, sql: string, parameters?: readonly unknown[]): Promise<any>;
  static find<T extends BaseEntity>(this: ModelClass<T>, id: PrimaryKeyValue): Promise<T | null>;
  static find<T extends BaseEntity>(this: ModelClass<T>, options?: FindManyOptions<T>): Promise<T[]>;   // 0.5 list form
  static findOrFail<T extends BaseEntity>(this: ModelClass<T>, id: PrimaryKeyValue): Promise<T>;
  static findByRouteKey<T extends BaseEntity>(this: ModelClass<T>, key: string): Promise<T | null>;
  getRouteKey(): string | number | bigint | boolean | Date;
}

/** A model class: its instance type plus the `BaseEntity` statics the Model API calls. */
type ModelClass<T extends BaseEntity = BaseEntity> = { new (): T } & typeof BaseEntity;
type PrimaryKeyValue = string | number | bigint;

type ColumnKey<T = any> = {
  [K in Extract<keyof T, string>]: T[K] extends (...args: any[]) => any ? never : K;
}[Extract<keyof T, string>];
type ModelWhere<T = any> = { [K in ColumnKey<T>]?: Exclude<T[K], undefined | null> };
type WhereComparison = "=" | "!=" | "<" | "<=" | ">" | ">=" | "like" | "not like";
type WhereOperator = WhereComparison | "in" | "not in";
type OrderDirection = "asc" | "desc";

interface Page<T = any> {
  readonly data: readonly T[];
  readonly total: number;
  readonly perPage: number;
  readonly currentPage: number;
  readonly lastPage: number;
}

class ModelQueryBuilder<T extends object = object> {
  constructor(repository: Repository<T>);                                    // Model.query() builds it
  where<K extends ColumnKey<T>>(column: K, value: Exclude<T[K], undefined | null>): this;
  where<K extends ColumnKey<T>>(column: K, operator: "in" | "not in", value: readonly Exclude<T[K], undefined | null>[]): this;
  where<K extends ColumnKey<T>>(column: K, operator: WhereComparison, value: Exclude<T[K], undefined | null>): this;
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
- **The 0.5 base is kept, with no breaking change.** `Model` stays the published class (`extends TypeORM`'s `BaseEntity`), so `ModelManagement`, `Route.model`, `UseModel`, factories and seeders keep working on it. `find` and `query` gain overloads around their 0.5 meanings: `User.find()` / `User.find(options)` still list (TypeORM's form), and `User.query("SELECT ...")` still runs raw SQL with TypeORM's `any` return; `find(id)` and `query()` are new. `examples/basic`'s `User.find()` keeps compiling. The raw `query(sql, parameters)` overload is deprecated in favour of `getRepository().query(...)`.
- **The #346 password rules stay, exactly where they are.** They live in `packages/database/src/eloquent/Model.ts` and their tests are unchanged:
  - The credential column comes from `static passwordField` (`password` by default): `save()`, `update()` and `updateFor()` hash a plain value in it unless `Hash.isHashed()` accepts it, and `findOneBy()` refuses a where object that carries it.
  - Request input must be validated as a plain password before it reaches the model. `cast()` stores a value that `Hash.isHashed()` accepts as it is, so a client that submits a well-formed scrypt string as its password has it stored as the credential, the same bypass as Laravel's hashed cast.
- **One typed facade, not a second query builder.** `query()` wraps one TypeORM `SelectQueryBuilder` created from the model's repository; `where()` calls combine with AND in call order, `first()` is `getOne()`, `get()` is `getMany()`, and `paginate()` runs on a clone of the builder. The clone is taken before the first `await`, so a `where()` / `limit()` / `orderBy()` added after the call, or a concurrent `paginate()` on the same facade, cannot change its page or its count, and the builder keeps no page window for a later `get()`. `limit()` sets a LIMIT for `first()` / `get()`; `paginate()` applies its own window to the clone and leaves an earlier `limit()` on the builder unchanged. TypeORM's count ignores the page window; its lazy count returns offset + rows for a short page, so an empty non-first page is counted again without the window (a page of 21 matches at `paginate(4, 10)` reports `total: 21`, not 30).
- **Columns are typed and checked twice.** `ColumnKey<T>` keeps the entity's own string data keys and drops function-valued members, so `where("save", ...)` does not compile, and a symbol-keyed brand (A3 [#121](https://github.com/Laratypes/Laratype/issues/121)) is never a column. At runtime every column name in `where()`, `orderBy()` and `routeKeyName` is resolved against the entity's `metadata.columns`: only a top-level column property name (its `propertyPath` equals its `propertyName`, and it is not a relation's join column) is accepted, and an unknown name, a relation (or its join column, which carries TypeORM's `relationMetadata`) or an embedded column's leaf name throws. Relation filters are DB3 [#147](https://github.com/Laratypes/Laratype/issues/147); embedded columns are not part of the surface. The caller's string is never interpolated: the metadata's `propertyName` is what TypeORM receives, `orderBy()` interpolates the metadata property into `${qb.alias}.${property}` with the query's own alias, and values are handed to TypeORM as parameters (as a named bind parameter in every form), never as SQL text.
- **Operators, direction and limits are allowlisted.** The three-argument `where()` builds its condition from a closed operator table (`=`, `!=`, `<`, `<=`, `>`, `>=`, `like`, `not like`, `in`, `not in`): the comparison text is the table's, the column is the metadata's property name and the value is a named bind parameter, so no caller text reaches the SQL. An operator outside the list throws, and `in` / `not in` require an array (an empty one matches none for `in`, all for `not in`); each element is read once into a fresh list before it is transformed or bound. `orderBy()` accepts `asc` / `desc` in any case at runtime. `limit()` takes a positive safe integer; `paginate()` takes `page >= 1` and `perPage` from 1 to 100 (the cap is 100, so a request cannot ask for an unbounded page), both safe integers, and their offset must stay a safe integer.
- **A `where()` value is a scalar.** It is a string, a finite number, a bigint, a boolean, a valid `Date` or a `Buffer`; every other value (an object, an array, `NaN`, `Infinity`, an invalid `Date`, a function, a symbol) throws before TypeORM sees it. A plain `Uint8Array` is refused because mysql2 expands it into `` `0` = 1, `1` = 2 ``; wrap it with `Buffer.from()`. A `Date` is told by its internal slot (`util.types.isDate`) plus a valid time value, not `instanceof`: an object that only inherits `Date.prototype` is refused as an object, and a `Date` subclass whose `getTime()` throws is still a valid `Date` (the slot is read through `Date.prototype.getTime`). This matters for security: mysql2 escapes an object as `key = value` pairs, so `where("email", { email: 1 })` would send `email = email = 1` and match every row, and an array value would be a syntax error. `in` / `not in` take an array of at most 1,000 of those scalars, with no nested arrays, objects, `null` or `undefined`: Postgres allows 65,535 parameters and sqlite 32,766.
- **A column's value transformer applies once to every `where()` value.** The facade builds every condition itself: the three-argument form with its operator from the closed table, and the two-argument and object forms as `column = :parameter`. It applies the column's `transformer.to` to the value, and to every `in` / `not in` element, once, before binding it: a transformer array runs in declaration order, as TypeORM's `find` does. The raw value and the transformed one must both be a scalar; a transformer that returns an object is refused with the diagnostic below in every form, so mysql2 never escapes it. TypeORM 0.3.26's object-form `andWhere()` applies `transformer.to` to the `FindOperator` wrapper instead of its value (a lower-casing transformer throws there), which is why the facade builds the condition itself rather than handing a caller value to TypeORM's object form.
- **`get()` and `first()` are unbounded.** `get()` reads every match, and `first()` without `orderBy()` returns an engine-defined row: never call `get()` on a request-driven query without `limit()` or `paginate()`.
- **LIKE escaping is the app's job.** A `like` / `not like` value is parameterized, but `%` and `_` in user input stay wildcards; the app escapes them before the call.
- **`paginate()` gives a plain page.** It resolves `{ data, total, perPage, currentPage, lastPage }` as one object literal: no class, no getters, `page` defaults to 1, `perPage` to 15, and `lastPage` is `max(1, ceil(total / perPage))`. It adds no order of its own: page order is engine-defined unless the caller sets `orderBy()` on a unique column, as `get()` is. http.md › Resources `paginate(page)` takes it as is (an object with an array `data` plus plain meta fields). #339 adds a refused-key check for page-level keys in the resource; `Page` has no own `toJSON` or `constructor` key, so it is unrelated to those names.
- **`find` / `findOrFail`.** A string, number or bigint argument is the primary key (`findOne({ where: { [primaryKey]: id } })`); no argument, `undefined` or an object keeps the 0.5 list form. `find` keeps the 0.5 `typeof` check, so it also accepts a non-finite number; do not bind one. `findOrFail` is strict: a non-primitive id (`null`, `undefined`, a boolean, an object, an array) and a non-finite number (`NaN`, `Infinity`, `-Infinity`) throw `ModelError` and never reach the list form, so request input can go there. Never pass request input to `find()` without a type check: the 0.5 list overload makes `find()` non-strict for every non-id argument, so a strict `find()` for arbitrary input is impossible without dropping that overload; use `findOrFail()` or `query().where()`.
- **A missing model is a 404 with a generic body.** `ModelNotFoundException extends @laratype/support`'s `NotFoundException` (a responsible `Exception`), so the existing exception filter answers 404 `{ code: "NOT_FOUND", message: "Resource not found!" }` with no change to `@laratype/http`. Its own `message` is `No query results for model [User] 42`, for logs and tests; `toJson()` keeps the model name and the key off the wire.
- **Primary key metadata.** `primaryKey` reads `getRepository().metadata.primaryColumns[0].propertyName` (the `ModelManagement.getPrimaryKeyFromModel` read). No primary column and a composite primary key both throw `ModelError`: `find` and `findOrFail` need one key. A composite-key model sets `static routeKeyName` to the one column a lookup uses and queries with `query().where(...)`.
- **The BindableModel statics.** `primaryKey`, `routeKeyName` (a model property name, `primaryKey` when unset) and `findByRouteKey(key)` satisfy [BindableModel](#bindablemodel) structurally; DB1 adds no `BindableModel` interface type (H7 [#118](https://github.com/Laratypes/Laratype/issues/118) owns it). `findByRouteKey` converts the raw path string by the route key column's metadata type:
  - an integer column (the `Number` constructor and the integer column types) takes only a canonical integer string: optional `-`, no leading zero, no space, no exponent, no decimal point, and `String(Number(key)) === key` with a safe integer, so `01`, `1.0`, `1e3`, `+1`, `" 1"` and values above 2^53 are refused;
  - a fractional column (`float`, `double`, `real`, `decimal`, `numeric`, and the other float / decimal types) is not a route key: `findByRouteKey()` and `getRouteKey()` throw the configuration error below, unless the column has a transformer and owns its own conversion;
  - a `Date` column type takes what `new Date(key)` parses; an invalid date is refused;
  - a time-only column (`time`, `timetz`, `time with time zone`, `time without time zone`) keeps the path string: TypeORM hydrates a MySQL `TIME` as `"12:34:56"`, which `new Date()` rejects. The key must match `[±]H[H[H]]:MM[:SS[.fffffff]]` (up to 838 hours, so MySQL's `-838:59:59` and above-24h values pass; seven fractional digits cover SQL Server, while MySQL and PostgreSQL round a longer input), plus a `±HH[:MM[:SS]]` offset of at most 15 hours only on `timetz` / `time with time zone`, whose time is PostgreSQL's `00:00`–`24:00` (`24:00` only as the exact end of the day) with no negative value; any other spelling is a miss before the driver parses the bind (PostgreSQL rejects a malformed time with an error, not a miss);
  - a `uuid` (and SQL Server `uniqueidentifier`) column takes a canonical 8-4-4-4-12 hexadecimal UUID in any case; any other spelling is a miss before the database parses it (PostgreSQL rejects a malformed bind with an error, not a miss);
  - a boolean column takes `true` / `1` and `false` / `0`;
  - every other column type (string, enum, and `bigint`, which keeps its precision) keeps the string as it is.
  A transformed route key runs the path string through the column's `transformer.to` (declaration order) exactly once and applies the plain path's type rule to the result before binding it: a string goes through the same conversion (a uuid must be canonical, an integer canonical and safe, a date parseable, a time matches the time-only rule above, a boolean `true` / `1` / `false` / `0`), and a value `to` already typed takes the column's class (a number for an integer column must be a safe integer, a `Date` for a date column valid, a boolean for a boolean column a boolean, and a non-string is never a uuid or a time). A value that fails the check or is not a scalar is a miss, and so is a `to` that throws on the path string (an attacker-controlled input answers 404, never 500); nothing is queried. The lookup runs through `findOne`, so a transformed key hydrates the same shape as a plain key, eager relations included, and keeps its single row (`take: 1`, `LIMIT 1`). A key that is not a string at runtime is a miss too. `getRouteKey()`'s hydrated value resolves when the transformer's `to` accepts what its `from` emits (a round-trippable transformer such as `"item-42"` ↔ `42`). A key that cannot convert is a miss (`null`), never a throw; a `routeKeyName` that is not a column, or an untransformed fractional column, is a configuration bug and throws.
- **`getRouteKey()`** (instance) returns `this[routeKeyName ?? primaryKey]`, the route key in the type its column declares: `string | number | bigint | boolean | Date`. It agrees with `findByRouteKey()`, which converts the raw path string to that same type. The column must be loaded: a partial `select` that omits it, or a `null` value, throws the missing-key diagnostic below instead of emitting an unusable `undefined`; `0`, `false`, `""` and `0n` are valid keys. A value that is not a string, finite number, bigint, boolean or valid `Date` (for example an object a `transformer.from` hydrated) throws the non-route-key diagnostic below instead of emitting something a route cannot serialize. It reads the entity metadata to check the route key column, so the model's DataSource must be initialized (as it is after boot, when `route()` runs); without one it throws. A route consumer (H13 [#162](https://github.com/Laratypes/Laratype/issues/162)'s `route()`) serializes a boolean as `"true"` / `"false"` and a Date as its ISO 8601 string with milliseconds (`toISOString()`, which `findByRouteKey()`'s `new Date(key)` parses back); a time or a transformed string is already a string. H14 [#163](https://github.com/Laratypes/Laratype/issues/163) uses the value too. DB1 lands it on the model base.

### Diagnostics
The 0.5 `Model` that PR [#346](https://github.com/Laratypes/Laratype/pull/346) @ 74b7e8245a6f86832f6d048bb6a62ed79a33011e changes (`packages/database/src/eloquent/Model.ts`) throws, instead of matching a password in the query:
- `[@laratype/database] findOneBy() cannot look a user up by password: look the user up without it, then check the password with Hash.check()`

`ModelError` (`name = "ModelError"`):
- `[@laratype/database] <Model> has no primary key: mark one column with @PrimaryColumn or @PrimaryGeneratedColumn`
- `[@laratype/database] <Model> has a composite primary key (<property>, ...): the v1 Model needs one primary key, so set static routeKeyName to the property a lookup uses`
- `[@laratype/database] <Model>.routeKeyName "<name>" is not a column of the model`
- `[@laratype/database] <Model> route key "<name>" is a float or decimal column: a route key must be an integer or string column, or a column with a transformer`
- `[@laratype/database] <Model> has no route key "<name>" loaded: select the column before getRouteKey()`
- `[@laratype/database] <Model> route key "<name>" is not a string, number, bigint, boolean or Date, got <type>`
- `[@laratype/database] <Model> has no column "<name>": where() takes a column property of the model`
- `[@laratype/database] <Model> has no column "<name>": orderBy() takes a column property of the model`
- `[@laratype/database] where() takes one of =, !=, <, <=, >, >=, like, not like, in, not in, got <type>`
- `[@laratype/database] where() takes an array for "<in|not in>", got <type>`
- `[@laratype/database] where() takes a column name or a where object, got <value>`
- `[@laratype/database] where() cannot filter "<column>" with <null|undefined>: IS NULL filters are not part of the v1 surface`
- `[@laratype/database] where() takes a scalar value for "<column>" (a string, a finite number, a bigint, a boolean, a valid Date or a Buffer), got <type>`
- `[@laratype/database] where() takes scalar elements for "<column>" in "<in|not in>" (a string, a finite number, a bigint, a boolean, a valid Date or a Buffer), got <type> at index <n>`
- `[@laratype/database] where() transformer for "<column>" returned <type>: a transformer must return a scalar value (a string, a finite number, a bigint, a boolean, a valid Date or a Buffer)`
- `[@laratype/database] where() transformer for "<column>" returned <type> at index <n> in "<in|not in>": a transformer must return a scalar value (a string, a finite number, a bigint, a boolean, a valid Date or a Buffer)`
- `[@laratype/database] where() takes at most 1000 elements for "<column>" in "<in|not in>", got <n>`
- `[@laratype/database] <Model>.findOrFail() takes a string, number or bigint primary key, got <type>`
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
- A `null` value (two-argument, object, comparison, or an `in` / `not in` element) does not compile, even for a `T | null` property.
- Object keys, `orderBy` directions and `find` / `findOrFail` keys are checked by their parameter types; a symbol key is not a `ColumnKey`.
- `ColumnKey`, `ModelWhere` and `Page` have a wide default, so the bare name is usable (`ColumnKey` is `string`, `Page` is `Page<any>`).

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
// { data: readonly User[], total, perPage: 15, currentPage: 1, lastPage } — UserResource.paginate(page) takes it as is

const user = await User.find(1);                 // User | null
const required = await User.findOrFail(1);       // User, or a 404
const bound = await User.findByRouteKey("1");    // User | null: H7 answers a miss with 404

class Post extends Model {
  declare readonly slug: string;
  static override readonly routeKeyName = "slug";   // /posts/:post looks posts up by slug
}
const post = await Post.findByRouteKey("hello");    // Post | null
```
Tests: [`packages/database/__tests__/Model.statics.test.ts`](../../packages/database/__tests__/Model.statics.test.ts), [`ModelQueryBuilder.test.ts`](../../packages/database/__tests__/ModelQueryBuilder.test.ts) and the type tests [`ModelQueryBuilder.test-d.ts`](../../packages/database/__tests__/ModelQueryBuilder.test-d.ts). `Model.statics.test.ts` stubs the repository over arrays in memory, as the 0.5 `Model.test.ts` does; most of `ModelQueryBuilder.test.ts` stubs the query builder the same way, and its last group builds a real MySQL `DataSource` and `SelectQueryBuilder` with the `mysql2` driver (a `@laratype/database` devDependency) to read the SQL and parameters, without opening a connection. The suite therefore needs the driver but no running database server.

### Non-goals
- No fillable / hidden masking (DB2 [#146](https://github.com/Laratypes/Laratype/issues/146)), relations or `with()` (DB3 [#147](https://github.com/Laratypes/Laratype/issues/147)), migrations (DB4 [#148](https://github.com/Laratypes/Laratype/issues/148)), factories and seeders (DB5 [#149](https://github.com/Laratypes/Laratype/issues/149)) or the container `DataSource` (DB6 [#150](https://github.com/Laratypes/Laratype/issues/150)).
- No relation filters, embedded paths, composite keys, cursor pagination, aggregates (`count`, `sum`, ...), soft-delete helpers, a paginator class, page URLs / links, or float / decimal route keys (a transformer owns a fractional key's conversion).
- No `IS NULL` filters: `where()` refuses a `null` or `undefined` value in every form (two-argument, object and comparison operator), and the types exclude both (inside an `in` / `not in` list too), because TypeORM would bind `= NULL`, which never matches, and some drivers reject an undefined bind.
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
