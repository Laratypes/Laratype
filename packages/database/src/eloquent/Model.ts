import { Hash, isTrustedHash, type TrustedHash } from "@laratype/support";
import {
  BaseEntity,
  type ColumnType,
  type DeepPartial,
  type EntityMetadata,
  type FindManyOptions,
  type FindOneOptions,
  type FindOptionsWhere,
  Raw,
  type SaveOptions,
  type UpdateResult,
} from "typeorm";
import ModelError from "../exceptions/ModelError";
import ModelNotFoundException from "../exceptions/ModelNotFoundException";
import {
  type ColumnMetadata,
  formatValue,
  isScalarValue,
  isValidDate,
  ownColumn,
  type ScalarValue,
  transformTo,
  valueType,
} from "./internal";
import ModelQueryBuilder from "./ModelQueryBuilder";

/** A primary key value `find()` and `findOrFail()` take: a numeric id, a UUID / string id, or a bigint id. */
export type PrimaryKeyValue = string | number | bigint;

/** A model class: the instance type its statics return, plus the TypeORM `BaseEntity` statics they call. */
export type ModelClass<T extends BaseEntity = BaseEntity> = { new (): T } & typeof BaseEntity;

/**
 * The write input of `save()`, `update()` and `updateFor()`: a plain row where the credential column may also be a
 * `Hash.trusted()` value, stored as it is instead of being hashed again (docs/v1/database.md › Model).
 */
export type TrustedInput<T> = DeepPartial<{ [K in keyof T]: T[K] | TrustedHash }>;

/** The drivers whose route-key time range the lookup knows; any other driver takes the strict common range. */
type RouteKeyDriver = "mysql" | "postgres" | "mssql" | "unknown";

/**
 * The DataSource driver behind a model (docs/v1/database.md › BindableModel): MySQL / MariaDB's `TIME` is wider than
 * 24 hours, PostgreSQL's `time` ends at 24:00:00 and SQL Server's at 23:59:59.fffffff, so the route-key rule depends
 * on the driver and not only on the column type.
 */
const routeKeyDriver = (model: typeof Model): RouteKeyDriver => {
  const type = model.getRepository().manager?.connection?.driver?.options?.type;
  if (type === "mysql" || type === "mariadb" || type === "aurora-mysql") {
    return "mysql";
  }
  if (type === "postgres" || type === "aurora-postgres") {
    return "postgres";
  }
  return type === "mssql" ? "mssql" : "unknown";
};

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
 * Time-only column types keep the path string after validation: TypeORM hydrates a MySQL `TIME` as `"12:34:56"`,
 * which `new Date()` rejects, so they do not take the Date branch (docs/v1/database.md › BindableModel).
 */
const TIME_TYPES: readonly ColumnType[] = ["time", "timetz", "time with time zone", "time without time zone"];

/** Column types whose hydrated time carries a UTC offset (PostgreSQL `timetz` / `time with time zone`). */
const ZONED_TIME_TYPES: readonly ColumnType[] = ["timetz", "time with time zone"];

/**
 * A time key in the form MySQL `TIME` and PostgreSQL `time` / `timetz` hydrate: an optional leading `-` (MySQL's
 * negative TIME; positive times carry no sign), minutes and seconds 00-59, a fraction on the seconds, and an offset
 * for a zoned PostgreSQL column (docs/v1/database.md › BindableModel).
 */
const TIME_KEY =
  /^(?<time>-?[0-9]{1,3}:[0-5][0-9](?::[0-5][0-9](?:\.[0-9]{1,7})?)?)(?:(?<sign>[+-])(?<offsetHour>[0-9]{2})(?::(?<offsetMinute>[0-5][0-9]))?(?::(?<offsetSecond>[0-5][0-9]))?)?$/;

/** PostgreSQL's end of day: `24:00:00` with all-zero minutes and seconds is its only 24-hour time. */
const END_OF_DAY = /^24:00(?::00(?:\.0+)?)?$/;

/** A calendar date a `date` column hydrates: exactly `YYYY-MM-DD`. */
const DATE_ONLY_KEY = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/** Whether a year, month and day form a real calendar day: not `2024-02-30`, and no year zero. */
const isCalendarDay = (year: number, month: number, day: number): boolean => {
  // Neither PostgreSQL nor MySQL has a year zero in a DATE value
  if (year < 1 || month < 1 || month > 12) {
    return false;
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day >= 1 && day <= days;
};

/** Whether `key` is a real day in `YYYY-MM-DD` form (not `2024-02-30`, `0000-00-00`, or a timestamp). */
const isCalendarDate = (key: string): boolean => {
  const match = DATE_ONLY_KEY.exec(key);
  return match !== null && isCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
};

/**
 * The day a datetime / timestamp string starts with: V8 normalizes an impossible one on parse (`2024-02-30T…`
 * becomes March 1), but a transformed string binds as the transformer returned it and the database rejects it.
 */
const LEADING_CALENDAR_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?=$|[T ])/;

/** Whether a datetime / timestamp string carries no impossible `YYYY-MM-DD` day at its start. */
const hasRealCalendarDate = (key: string): boolean => {
  const match = LEADING_CALENDAR_DATE.exec(key);
  return match === null || isCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
};

/**
 * Whether a time-only key is a representation the configured driver accepts (docs/v1/database.md › BindableModel):
 * MySQL / MariaDB `-838:59:59.000000`..`838:59:59.000000`, PostgreSQL `00:00:00`..`24:00:00` (24:00:00 exact), SQL
 * Server `00:00:00`..`23:59:59.fffffff`, and an unknown driver the strict common `00:00:00`..`23:59:59`. An offset is
 * only a PostgreSQL `timetz` form. A malformed key is the documented miss before the driver parses it; unrelated
 * database errors still propagate because this runs before the lookup.
 */
const isTimeKey = (type: ColumnType, key: string, driver: RouteKeyDriver): boolean => {
  const match = TIME_KEY.exec(key);
  const groups = match?.groups;
  if (groups?.time === undefined) {
    return false;
  }
  const time = groups.time;
  const hours = Math.abs(Number(time.split(":")[0]));
  if (driver === "mysql") {
    // MySQL's TIME ends at 838:59:59.000000: a fraction past that second is out of range, for either sign
    if (hours > 838 || /^-?838:59:59\.0*[1-9]/.test(time)) {
      return false;
    }
  } else if (time.startsWith("-") || hours > (driver === "postgres" ? 24 : 23)) {
    // PostgreSQL and SQL Server never hydrate a negative time; SQL Server stops at 23:59:59
    return false;
  } else if (driver === "postgres" && hours === 24 && !END_OF_DAY.test(time)) {
    return false;
  }
  if (groups.sign === undefined) {
    return true;
  }
  // A plain time never carries a zone; an offset belongs to PostgreSQL's timetz / time with time zone
  return ZONED_TIME_TYPES.includes(type) && driver === "postgres" && Number(groups.offsetHour) <= 15;
};

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
  routeKeyNotScalar: (model: string, name: string, value: unknown): string =>
    `[@laratype/database] ${model} route key ${formatValue(name)} is not a string, number, bigint, boolean or Date,`
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
  driver: RouteKeyDriver;
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
  return { metadata, property, column, driver: routeKeyDriver(model) };
};

/**
 * Converts a raw path string to the type of the route key column (docs/v1/database.md › BindableModel).
 * `undefined` is a key that cannot convert: `findByRouteKey()` answers it as a miss, never as a throw.
 */
const convertRouteKey = (
  column: ColumnMetadata,
  key: string,
  driver: RouteKeyDriver,
): string | number | boolean | Date | undefined => {
  const type = column.type;
  if (NUMERIC_TYPES.includes(type)) {
    // The round-trip check refuses 1e3, " 1", "01", "1.0" and values above 2^53, which Number cannot hold exactly
    return INTEGER_KEY.test(key) && String(Number(key)) === key && Number.isSafeInteger(Number(key))
      ? Number(key)
      : undefined;
  }
  if (TIME_TYPES.includes(type)) {
    // A MySQL TIME hydrates as "HH:MM:SS" and a PostgreSQL time as a string too, never a Date; a malformed one is a
    // miss before the driver parses the bind (PostgreSQL throws QueryFailedError on a bad time)
    return isTimeKey(type, key, driver) ? key : undefined;
  }
  if (type === "date") {
    // TypeORM hydrates a DATE column as "YYYY-MM-DD"; binding new Date(key) would shift the day in a negative-UTC process
    return isCalendarDate(key) ? key : undefined;
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
  if (column.enum !== undefined && !column.enum.some((value) => String(value) === key)) {
    // PostgreSQL rejects a value outside an enum's labels; answer it as the documented miss before the lookup
    return undefined;
  }
  return key;
};

/**
 * A value `getRouteKey()` can return and a route consumer can serialize. It is narrower than `isScalarValue()`: a
 * route key is never a `Buffer`, and a non-finite number cannot route.
 */
const isRouteKeyValue = (value: unknown): value is string | number | bigint | boolean | Date =>
  typeof value === "string" ||
  typeof value === "bigint" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value)) ||
  isValidDate(value);

/**
 * Applies the plain path's column-type rule to a value `transformer.to` returned (docs/v1/database.md › BindableModel).
 * A string is only validated and binds as the transformer returned it, so a `date` / `datetime` / integer string does
 * not become a `Date` (which the driver would serialize in the process timezone); MySQL takes the parsed boolean for a
 * boolean column because a `TINYINT` compares text numerically. A typed value must match the column's class and enum
 * labels. `undefined` is a miss.
 */
const checkRouteKeyType = (
  column: ColumnMetadata,
  value: ScalarValue,
  driver: RouteKeyDriver,
): ScalarValue | undefined => {
  const type = column.type;
  if (typeof value === "string") {
    const converted = convertRouteKey(column, value, driver);
    if (converted === undefined) {
      return undefined;
    }
    // A datetime / timestamp string binds as the transformer returned it, so an impossible day V8 normalizes on
    // parse (`2024-02-30T…`) must be a miss before the database rejects the bind
    if (DATE_TYPES.includes(type) && type !== "date" && !hasRealCalendarDate(value)) {
      return undefined;
    }
    // MySQL stores a boolean as TINYINT and compares a string numerically ('true' is 0), so it takes the boolean
    // the column rule parsed; another driver parses the text bind itself and keeps the transformer's string
    return driver === "mysql" && BOOLEAN_TYPES.includes(type) ? converted : value;
  }
  if (NUMERIC_TYPES.includes(type)) {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
  }
  if (DATE_TYPES.includes(type)) {
    return isValidDate(value) ? value : undefined;
  }
  if (BOOLEAN_TYPES.includes(type)) {
    return typeof value === "boolean" ? value : undefined;
  }
  if (UUID_TYPES.includes(type) || TIME_TYPES.includes(type)) {
    // A uuid and a time are strings on the wire: a number or a Date from a transformer is not the column's type
    return undefined;
  }
  if (column.enum !== undefined && !column.enum.some((entry) => String(entry) === String(value))) {
    return undefined;
  }
  return value;
};

/**
 * Looks the model up by an already converted route key through `findOne`, so a transformed key (and a plain SQL
 * Server `time` key, which the driver's `Time` parameter rejects) hydrates the same shape as a plain key: eager
 * relations and the single row (TypeORM's `take: 1`). The `raw` operator carries the value as a named parameter.
 * TypeORM 0.3.26 applies `transformer.to` to a find operator's value, but a `Raw` built from a generator has an
 * empty value list, so the column's transformer does not run a second time (Model › findByRouteKey).
 */
const findOneByRouteKey = <T extends BaseEntity>(
  model: ModelClass<T>,
  property: string,
  value: ScalarValue,
): Promise<T | null> => {
  const options = {
    // The alias path comes from the entity metadata and TypeORM's query alias, never from the caller's path string
    where: { [property]: Raw((aliasPath) => `${aliasPath} = :routeKey`, { routeKey: value }) },
  } as FindOneOptions<BaseEntity>;
  return model.findOne(options) as Promise<T | null>;
};

/**
 * The credential value of one write: a `Hash.trusted()` value is stored as it is, every other value is hashed with
 * `Hash.makeAsync()` (scrypt on the libuv pool), even a string that looks like a hash, so request input never chooses
 * the stored credential. The facade call keeps a custom Hasher's async fallback.
 */
const castPassword = async (model: string, key: string, value: unknown): Promise<string> => {
  if (isTrustedHash(value)) return value.hash;
  if (typeof value !== "string") {
    throw new TypeError(
      `[@laratype/database] ${model} credential cast: "${key}" takes a string or Hash.trusted(hash), got ${valueType(value)}`,
    );
  }
  return Hash.makeAsync(value);
};

const cast = async (model: string, input: Record<string, any>, passwordField: string): Promise<Record<string, any>> => {
  const result: Record<string, any> = {};
  for (const key in input) {
    const value = input[key];
    // A TrustedHash only means something for the credential column; anywhere else it would reach TypeORM as an object
    if (key !== passwordField && isTrustedHash(value)) {
      throw new TypeError(
        `[@laratype/database] ${model} credential cast: Hash.trusted() is only for the "${passwordField}" column, not "${key}"`,
      );
    }
    result[key] = key === passwordField ? await castPassword(model, key, value) : value;
  }
  return result;
}

/** Whether a where object, an array of them, or a nested relation object names the credential column. */
const carriesPassword = (where: unknown, passwordField: string, seen: WeakSet<object>): boolean => {
  if (Array.isArray(where)) {
    if (seen.has(where)) return false;
    seen.add(where);
    return where.some((entry) => carriesPassword(entry, passwordField, seen));
  }
  if (where === null || typeof where !== "object") return false;
  // A relation's where is a plain object (or a null-prototype map); a Date, a Buffer or a FindOperator is a value
  const prototype = Object.getPrototypeOf(where);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (seen.has(where)) return false;
  seen.add(where);
  if (Object.prototype.hasOwnProperty.call(where, passwordField)) return true;
  return Object.values(where).some((value) => carriesPassword(value, passwordField, seen));
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
   * The raw path string is converted to the route key column's type first (or through the column's transformer, whose
   * result is checked against the column's type), and a key that cannot convert or a transformer that throws resolves
   * `null`. The lookup goes through `findOne`, so eager relations and a single row match a plain key.
   */
  static findByRouteKey<T extends BaseEntity>(
    this: ModelClass<T>,
    key: string,
  ): Promise<T | null>;

  static async findByRouteKey(key: string): Promise<any> {
    const { property, column, driver } = routeKeyColumn(this);
    // The route key is a path string: a JS caller's other type is a miss, never a coercion or a throw
    if (typeof key !== "string") {
      return null;
    }
    let routeKey: ScalarValue | undefined;
    try {
      // A transformer owns the conversion: the path string is what getRouteKey() emitted, so transformer.to takes it
      const converted = column.transformer === undefined
        ? convertRouteKey(column, key, driver)
        : transformTo(column.transformer, key);
      if (converted === undefined || !isScalarValue(converted)) {
        return null;
      }
      // A transformed value is in the column's database representation, so the plain path's type rule applies to it
      routeKey = checkRouteKeyType(column, converted, driver);
    } catch {
      // A throwing transformer (or a value whose scalar check throws, such as a hostile Proxy) is a 404, not a 500
      return null;
    }
    if (routeKey === undefined) {
      return null;
    }
    if (column.transformer === undefined) {
      // SQL Server types a plain `time` bind as a `Time` parameter, whose tedious validator runs Date.parse on the
      // string (NaN for time-only text) and rejects it. The raw form keeps the exact text, fractional digits
      // included, and SQL Server converts the untyped parameter to time.
      if (driver === "mssql" && TIME_TYPES.includes(column.type)) {
        return findOneByRouteKey(this, property, routeKey);
      }
      return this.findOne({ where: { [property]: routeKey } } as FindOneOptions<Model>);
    }
    return findOneByRouteKey(this, property, routeKey);
  }

  /**
   * Saves all given entities in the database.
   * If entities do not exist in the database then inserts, otherwise updates.
   */
  static save<T extends BaseEntity>(
    this: ModelClass<T>,
    entities: Array<DeepPartial<T> | TrustedInput<T>>,
    options?: SaveOptions,
  ): Promise<T[]>;
  /**
   * Saves a given entity in the database.
   * If entity does not exist in the database then inserts, otherwise updates.
   */
  static save<T extends BaseEntity>(
    this: ModelClass<T>,
    entity: DeepPartial<T> | TrustedInput<T>,
    options?: SaveOptions,
  ): Promise<T>;

  static async save(data: any, options?: SaveOptions) {
    if(Array.isArray(data)) {
      const input: Record<string, any>[] = [];
      // Sequential: each derivation costs 16 MiB, so an array must not queue one per row at once
      for (const item of data) {
        input.push(await cast(this.name, fillableGuard(item, this.fillable), this.passwordField));
      }
      return super.save(input, options);
    }

    const input = await cast(this.name, fillableGuard(data, this.fillable), this.passwordField);
    return super.save(input, options);
  }

  static update<T extends BaseEntity>(
    this: ModelClass<T>,
    criteria: any,
    data: DeepPartial<T> | TrustedInput<T>,
  ): Promise<UpdateResult>;

  static async update(criteria: any, data: any): Promise<UpdateResult> {
    const input = await cast(this.name, fillableGuard(data, this.fillable), this.passwordField);

    return super.update(criteria, input);
  }

  /**
   * Updates the given model with provided data.
   */
  static updateFor<T extends BaseEntity>(
    this: ModelClass<T>,
    model: T,
    data: DeepPartial<T> | TrustedInput<T>,
  ): Promise<T>;

  static async updateFor(model: any, data: any) {
    const input = await cast(this.name, fillableGuard(data, this.fillable), this.passwordField);
    for (const field in input) {
      if(Object.prototype.hasOwnProperty.call(model, field)) {
        model[field] = input[field];
      }
    }

    await model.save();
    return model;
  }

  /**
   * Finds first entity that matches given conditions. A where object, an array of where objects or a nested relation
   * object that names the credential column rejects: a salted hash never matches in a query.
   */
  static findOneBy<T extends BaseEntity>(this: ModelClass<T>, where: FindOptionsWhere<T>): any;

  // Not cast: a salted password hash never matches in a where clause; check it with Hash.check() after the lookup
  static async findOneBy(where: any): Promise<any> {
    // A 0.5 caller's { email, password }, an array of conditions or a nested where would put a plain password in the
    // SQL parameters and never match a hash
    if (carriesPassword(where, this.passwordField, new WeakSet())) {
      throw new Error(
        "[@laratype/database] findOneBy() cannot look a user up by password: look the user up without it, then check the password with Hash.check()",
      );
    }
    return super.findOneBy(where);
  }

  /**
   * The value of this model's route key (docs/v1/database.md › BindableModel): `static routeKeyName`, or the primary
   * key, in the type the column declares. The column must be loaded: a partial select that omits it throws instead of
   * emitting an unusable `undefined`. A value a transformer's `from` hydrated as an object, or any other non-route-key
   * value, throws too.
   */
  getRouteKey(): string | number | bigint | boolean | Date {
    const model = this.constructor as typeof Model;
    const { metadata, property } = routeKeyColumn(model);
    const value = (this as unknown as Record<string, unknown>)[property];
    // A falsey key (0, false, "", 0n) is valid; a missing or null one is not loaded and cannot route
    if (value === undefined || value === null) {
      throw new ModelError(errors.missingRouteKey(metadata.targetName, property));
    }
    // A transformer.from() can hydrate an object, which no route consumer can serialize: refuse it at the source
    if (!isRouteKeyValue(value)) {
      throw new ModelError(errors.routeKeyNotScalar(metadata.targetName, property, value));
    }
    return value;
  }
}
