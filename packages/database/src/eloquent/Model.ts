import { Hash } from "@laratype/support";
import {
  BaseEntity,
  type ColumnType,
  type DeepPartial,
  type EntityMetadata,
  type FindManyOptions,
  type FindOneOptions,
  type FindOptionsWhere,
  type SaveOptions,
} from "typeorm";
import ModelError from "../exceptions/ModelError";
import ModelNotFoundException from "../exceptions/ModelNotFoundException";
import {
  type ColumnMetadata,
  formatValue,
  isScalarValue,
  ownColumn,
  transformTo,
  valueType,
} from "./internal";
import ModelQueryBuilder from "./ModelQueryBuilder";

/** A primary key value `find()` and `findOrFail()` take: a numeric id, a UUID / string id, or a bigint id. */
export type PrimaryKeyValue = string | number | bigint;

/** A model class: the instance type its statics return, plus the TypeORM `BaseEntity` statics they call. */
export type ModelClass<T extends BaseEntity = BaseEntity> = { new (): T } & typeof BaseEntity;

/**
 * Integer column types whose route key is a number. `bigint` stays a string on purpose: a Number conversion loses
 * precision above 2^53, and TypeORM reads a bigint column as a string anyway.
 */
const NUMERIC_TYPES: readonly ColumnType[] = [
  Number,
  "int",
  "int2",
  "int4",
  "integer",
  "smallint",
  "mediumint",
  "tinyint",
];

const DATE_TYPES: readonly ColumnType[] = [
  Date,
  "date",
  "datetime",
  "datetime2",
  "datetimeoffset",
  "smalldatetime",
  "timestamp",
  "timestamp without time zone",
  "timestamp with time zone",
  "timestamp with local time zone",
  "timestamptz",
  "seconddate",
];

/**
 * Time-only column types keep the path string: TypeORM hydrates a MySQL `TIME` as `"12:34:56"`, which `new Date()`
 * rejects, so they take the pass-through branch (docs/v1/database.md › BindableModel).
 */
const TIME_TYPES: readonly ColumnType[] = ["time", "timetz", "time with time zone", "time without time zone"];

/**
 * Fractional column types are not route keys: `getRouteKey()` returns a `1.5` that a canonical number string cannot
 * round trip with a decimal's scale (e.g. `"1.50"`), so the configuration is refused instead of answering a 404 for
 * an existing row. A transformer owns the conversion when a model needs one.
 */
const FRACTIONAL_TYPES: readonly ColumnType[] = [
  "float",
  "float4",
  "float8",
  "float64",
  "double",
  "double precision",
  "dec",
  "decimal",
  "numeric",
  "real",
  "smallmoney",
  "money",
  "smalldecimal",
  "fixed",
  "number",
];

const BOOLEAN_TYPES: readonly ColumnType[] = [Boolean, "boolean", "bool"];

/** The UUID column types (PostgreSQL `uuid`, SQL Server `uniqueidentifier`): a canonical 8-4-4-4-12 hexadecimal key. */
const UUID_TYPES: readonly ColumnType[] = ["uuid", "uniqueidentifier"];

/** A canonical UUID in any case; a malformed key is a miss before the database parses it (`uuid` rejects one). */
const UUID_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An integer string: no sign but `-`, no leading zero, no exponent, no space, no decimal point. */
const INTEGER_KEY = /^-?(?:0|[1-9][0-9]*)$/;

/** A primary key `find()` and `findOrFail()` accept: a string, a bigint or a finite number. */
const isPrimaryKeyValue = (value: unknown): value is PrimaryKeyValue =>
  typeof value === "string" || typeof value === "bigint" || (typeof value === "number" && Number.isFinite(value));

/** The Model's message text, in one place (errors-and-comments.md › Errors). */
const errors = {
  noPrimaryKey: (model: string): string =>
    `[@laratype/database] ${model} has no primary key: mark one column with @PrimaryColumn or @PrimaryGeneratedColumn`,
  compositePrimaryKey: (model: string, columns: string[]): string =>
    `[@laratype/database] ${model} has a composite primary key (${columns.join(", ")}): the v1 Model needs one`
    + " primary key, so set static routeKeyName to the property a lookup uses",
  routeKeyNameNotAColumn: (model: string, name: string): string =>
    `[@laratype/database] ${model}.routeKeyName ${formatValue(name)} is not a column of the model`,
  fractionalRouteKey: (model: string, name: string): string =>
    `[@laratype/database] ${model} route key ${formatValue(name)} is a float or decimal column:`
    + " a route key must be an integer or string column, or a column with a transformer",
  missingRouteKey: (model: string, name: string): string =>
    `[@laratype/database] ${model} has no route key ${formatValue(name)} loaded:`
    + " select the column before getRouteKey()",
  findOrFailId: (model: string, value: unknown): string =>
    `[@laratype/database] ${model}.findOrFail() takes a string, number or bigint primary key,`
    + ` got ${valueType(value)}`,
};

/**
 * The route key property and its column, checked as a configuration (docs/v1/database.md › BindableModel): an own
 * column, and not a float / decimal column unless a transformer owns its conversion. A bad configuration throws.
 */
const routeKeyColumn = (model: typeof Model): {
  metadata: EntityMetadata;
  property: string;
  column: ColumnMetadata;
} => {
  const metadata = model.getRepository().metadata;
  const property = model.routeKeyName ?? model.primaryKey;
  const column = ownColumn(metadata, property);
  if (column === undefined) {
    throw new ModelError(errors.routeKeyNameNotAColumn(metadata.targetName, property));
  }
  if (column.transformer === undefined && FRACTIONAL_TYPES.includes(column.type)) {
    throw new ModelError(errors.fractionalRouteKey(metadata.targetName, property));
  }
  return { metadata, property, column };
};

/**
 * Converts a raw path string to the type of the route key column (docs/v1/database.md › BindableModel).
 * `undefined` is a key that cannot convert: `findByRouteKey()` answers it as a miss, never as a throw.
 */
const convertRouteKey = (type: ColumnType, key: string): string | number | boolean | Date | undefined => {
  if (NUMERIC_TYPES.includes(type)) {
    // The round-trip check refuses 1e3, " 1", "01", "1.0" and values above 2^53, which Number cannot hold exactly
    return INTEGER_KEY.test(key) && String(Number(key)) === key && Number.isSafeInteger(Number(key))
      ? Number(key)
      : undefined;
  }
  if (TIME_TYPES.includes(type)) {
    // A MySQL TIME hydrates as "HH:MM:SS" and a PostgreSQL time as a string too, never a Date
    return key;
  }
  if (DATE_TYPES.includes(type)) {
    const date = new Date(key);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (UUID_TYPES.includes(type)) {
    // PostgreSQL rejects a malformed uuid as a bind error; answer it as the documented miss before the lookup
    return UUID_KEY.test(key) ? key : undefined;
  }
  if (BOOLEAN_TYPES.includes(type)) {
    if (key === "true" || key === "1") return true;
    if (key === "false" || key === "0") return false;
    return undefined;
  }
  return key;
};

/**
 * Looks the model up by an already converted route key, binding it as a parameter. The facade builds the condition
 * so TypeORM's object form cannot apply `transformer.to` a second time (ModelQueryBuilder › where).
 */
const findOneByRouteKey = <T extends BaseEntity>(
  model: ModelClass<T>,
  column: ColumnMetadata,
  value: unknown,
): Promise<T | null> => {
  const query = model.getRepository().createQueryBuilder();
  // The alias and property come from the entity metadata, never from the caller's path string
  return query.where(`${query.alias}.${column.propertyName} = :routeKey`, { routeKey: value }).getOne() as Promise<
    T | null
  >;
};

const cast = (input: Record<string, any>, passwordField: string) => {
  const result: Record<string, any> = {};
  for (const key in input) {
    result[key] = input[key];
    // A value that is already a hash is stored as it is, not hashed again
    if (key === passwordField && !Hash.isHashed(input[key])) {
      result[key] = Hash.make(input[key]);
    }
  }
  return result;
}

const fillableGuard = (input: Record<string, any>, fillable: string[]) => {
  const result: Record<string, any> = {};
  for (const key in input) {
    if(fillable.includes(key)) {
      result[key] = input[key];
    }
  }
  return result;
}

export default class Model extends BaseEntity {
  
  static readonly fillable: string[] = [];

  /**
   * The credential column: `save()`, `update()` and `updateFor()` hash a plain value in it, and `findOneBy()` refuses
   * it. A model that stores the password in another column overrides it, and the guard's `passwordField` names the same.
   */
  static readonly passwordField: string = 'password';

  /**
   * The column a lookup by route uses when a model does not set `routeKeyName`; read from the TypeORM metadata, as
   * `ModelManagement.getPrimaryKeyFromModel` does in 0.5. A model with no primary column, or a composite primary key,
   * throws: the v1 Model needs one primary key (docs/v1/database.md › Model).
   */
  static get primaryKey(): string {
    const metadata = this.getRepository().metadata;
    const columns = metadata.primaryColumns;
    if (columns.length === 0) {
      throw new ModelError(errors.noPrimaryKey(metadata.targetName));
    }
    if (columns.length > 1) {
      throw new ModelError(
        errors.compositePrimaryKey(metadata.targetName, columns.map((column) => column.propertyName)),
      );
    }
    return columns[0]!.propertyName;
  }

  /**
   * The property `findByRouteKey()` filters on, `primaryKey` when unset. It is a model property name, not a database
   * column name: `static override readonly routeKeyName = 'slug'` looks posts up by slug.
   */
  static readonly routeKeyName: string | undefined = undefined;

  /**
   * The typed query of this model (docs/v1/database.md › Model): `User.query().where('email', email).first()`.
   * The one-argument form is TypeORM's raw `query(sql, parameters)`, kept for 0.5 callers.
   */
  static query<T extends BaseEntity>(this: ModelClass<T>): ModelQueryBuilder<T>;

  /**
   * @deprecated Use `getRepository().query(sql, parameters)` for raw SQL: `query()` returns the query builder.
   */
  static query<T extends BaseEntity>(
    this: ModelClass<T>,
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<any>;

  static query(sql?: string, parameters?: readonly unknown[]): any {
    if (sql === undefined) {
      return new ModelQueryBuilder(this.getRepository());
    }
    return super.query(sql, parameters as unknown[] | undefined);
  }

  /**
   * Finds one model by its primary key. A string, number or bigint is the key; no argument, `undefined` or an
   * options object keeps TypeORM's list form (0.5 compatibility). A missing key resolves `null`.
   *
   * Never pass request input to the list form: use `findOrFail()` or `query().where()` for request input.
   */
  static find<T extends BaseEntity>(
    this: ModelClass<T>,
    id: PrimaryKeyValue,
  ): Promise<T | null>;

  /** The 0.5 / TypeORM list form: every entity, or the one `options` select. */
  static find<T extends BaseEntity>(
    this: ModelClass<T>,
    options?: FindManyOptions<T>,
  ): Promise<T[]>;

  static find(idOrOptions?: any): any {
    if (typeof idOrOptions === "string" || typeof idOrOptions === "number" || typeof idOrOptions === "bigint") {
      return this.findOne({ where: { [this.primaryKey]: idOrOptions } } as FindOneOptions<Model>);
    }
    return super.find(idOrOptions);
  }

  /**
   * Finds one model by its primary key, or throws `ModelNotFoundException` (an HTTP 404 through the existing
   * exception filter) instead of resolving `null`. A non-primitive key or a non-finite number is refused: unlike
   * `find()`, it never falls through to the 0.5 list form, so request input can go here (docs/v1/database.md › Model).
   */
  static findOrFail<T extends BaseEntity>(
    this: ModelClass<T>,
    id: PrimaryKeyValue,
  ): Promise<T>;

  static async findOrFail(id: PrimaryKeyValue): Promise<any> {
    if (!isPrimaryKeyValue(id)) {
      throw new ModelError(errors.findOrFailId(this.getRepository().metadata.targetName, id));
    }
    const found = await this.find(id);
    if (found === null || found === undefined) {
      throw new ModelNotFoundException(this.getRepository().metadata.targetName, id);
    }
    return found;
  }

  /**
   * Looks a model up by its route key (docs/v1/database.md › BindableModel): `routeKeyName`, or the primary key.
   * The raw path string is converted to the route key column's type first (or through the column's transformer),
   * and a key that cannot convert resolves `null`.
   */
  static findByRouteKey<T extends BaseEntity>(
    this: ModelClass<T>,
    key: string,
  ): Promise<T | null>;

  static async findByRouteKey(key: string): Promise<any> {
    const { property, column } = routeKeyColumn(this);
    // A transformer owns the conversion: the path string is what getRouteKey() emitted, so transformer.to takes it
    const converted = column.transformer === undefined
      ? convertRouteKey(column.type, key)
      : transformTo(column.transformer, key);
    if (converted === undefined || !isScalarValue(converted)) {
      return null;
    }
    if (column.transformer === undefined) {
      return this.findOne({ where: { [property]: converted } } as FindOneOptions<Model>);
    }
    return findOneByRouteKey(this, column, converted);
  }

  /**
   * Saves all given entities in the database.
   * If entities do not exist in the database then inserts, otherwise updates.
   */
  static save<T extends BaseEntity>(
    this: ModelClass<T>,
    entities: DeepPartial<T>[],
    options?: SaveOptions,
  ): Promise<T[]>;
  /**
   * Saves a given entity in the database.
   * If entity does not exist in the database then inserts, otherwise updates.
   */
  static save<T extends BaseEntity>(this: ModelClass<T>, entity: DeepPartial<T>, options?: SaveOptions): Promise<T>;

  static save(data: any, options?: SaveOptions) {
    if(Array.isArray(data)) {
      const input: Record<string, any>[] = [];
      data.forEach(item => {
        const castedItem = cast(fillableGuard(item, this.fillable), this.passwordField);
        input.push(castedItem);
      });
      return super.save(input, options);
    }

    const input = cast(fillableGuard(data, this.fillable), this.passwordField);
    return super.save(input, options);
  }

  static update(criteria: any, data: any) {
    const input = cast(fillableGuard(data, this.fillable), this.passwordField);
    
    return super.update(criteria, input);
  }

  /**
   * Updates the given model with provided data.
   */
  static updateFor<T extends BaseEntity>(this: ModelClass<T>, model: T, data: DeepPartial<T>): Promise<T>;

  static updateFor(model: any, data: any) {
    const input = cast(fillableGuard(data, this.fillable), this.passwordField);
    for (const field in input) {
      if(Object.prototype.hasOwnProperty.call(model, field)) {
        model[field] = input[field];
      }
    }

    return model.save().then(() => model);
  }

  /**
   * Finds first entity that matches given conditions.
   */
  static findOneBy<T extends BaseEntity>(this: ModelClass<T>, where: FindOptionsWhere<T>): any;
  
  // Not cast: a salted password hash never matches in a where clause; check it with Hash.check() after the lookup
  static findOneBy(where: any) {
    // A 0.5 caller's { email, password } would put a plain password in the SQL parameters and never match a hash
    if (where && typeof where === 'object' && Object.prototype.hasOwnProperty.call(where, this.passwordField)) {
      throw new Error(
        "[@laratype/database] findOneBy() cannot look a user up by password: look the user up without it, then check the password with Hash.check()",
      );
    }
    return super.findOneBy(where);
  }

  /**
   * The value of this model's route key (docs/v1/database.md › BindableModel): `static routeKeyName`, or the primary
   * key, in the type the column declares. The column must be loaded: a partial select that omits it throws instead of
   * emitting an unusable `undefined`.
   */
  getRouteKey(): string | number | bigint | boolean | Date {
    const model = this.constructor as typeof Model;
    const { metadata, property } = routeKeyColumn(model);
    const value = (this as unknown as Record<string, unknown>)[property];
    // A falsey key (0, false, "", 0n) is valid; a missing or null one is not loaded and cannot route
    if (value === undefined || value === null) {
      throw new ModelError(errors.missingRouteKey(metadata.targetName, property));
    }
    return value as string | number | bigint | boolean | Date;
  }
}
