import { Hash } from "@laratype/support";
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
  scopeNotModel: (model: string, key: string, value: unknown): string =>
    `[@laratype/database] ${model}.findByRouteKey(): the scope \`${key}\` is not a model instance, got ${valueType(value)}`,
  scopeNoRelation: (model: string, parent: string): string =>
    `[@laratype/database] ${model} has no relation to ${parent}: .scopeBindings() scopes a child lookup through a`
    + " relation whose target is the parent model",
  scopeNoJoinColumn: (model: string, relation: string): string =>
    `[@laratype/database] ${model} relation ${formatValue(relation)} has no join column: .scopeBindings() needs the`
    + " owning side of a relation to the parent",
  scopeComposite: (model: string, relation: string): string =>
    `[@laratype/database] ${model} relation ${formatValue(relation)} has a composite join column: .scopeBindings()`
    + " needs a single-column relation",
  scopeEmbedded: (model: string, relation: string, embedded: string): string =>
    `[@laratype/database] ${model} relation ${formatValue(relation)} is declared inside the embedded ${formatValue(embedded)}:`
    + " .scopeBindings() needs a relation on the model itself",
  scopeProto: (model: string): string =>
    `[@laratype/database] ${model} relation \`__proto__\` cannot scope a lookup: every object reads it as its prototype,`
    + " so the condition would be dropped",
  scopeAmbiguous: (model: string, parent: string, relations: string[]): string =>
    `[@laratype/database] ${model} has ${relations.length} relations to ${parent} (${relations.join(", ")}):`
    + ` .scopeBindings() cannot choose one; keep a single relation to ${parent}`,
  scopeRelationKind: (model: string, relation: string): string =>
    `[@laratype/database] ${model} relation ${formatValue(relation)} is not a many-to-one or an owning one-to-one`
    + " relation: .scopeBindings() needs the side that holds the join column",
  scopeDuplicate: (model: string, relation: string): string =>
    `[@laratype/database] ${model}: two scoped parents resolve to the relation ${formatValue(relation)}:`
    + " .scopeBindings() cannot scope the lookup by both",
  scopeNotLoaded: (model: string, parent: string, name: string): string =>
    `[@laratype/database] ${model} is scoped by ${parent}.${formatValue(name)}, which the parent instance has not`
    + " loaded: select it before .scopeBindings()",
  scopeNotScalar: (parent: string, name: string, value: unknown): string =>
    `[@laratype/database] ${parent}.${formatValue(name)} is not a string, number, bigint, boolean or Date, so it`
    + ` cannot scope a lookup: got ${valueType(value)}`,
  scopeTransformer: (model: string, relation: string): string =>
    `[@laratype/database] ${model} relation ${formatValue(relation)} references a column whose transformer.to() throws`
    + " on the parent value: .scopeBindings() cannot bind the parent key",
  scopeUnreadable: (model: string, parent: string, name: string): string =>
    `[@laratype/database] ${model} is scoped by ${parent}.${formatValue(name)}, which the parent instance could not read:`
    + " .scopeBindings() cannot bind the parent key",
  scopeRouteKey: (model: string, name: string): string =>
    `[@laratype/database] ${model} route key ${formatValue(name)} is also the relation's join column: .scopeBindings()`
    + " cannot scope the lookup by it",
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
 * One scoped lookup condition (H14 #163): the join column of this model's relation to a parent, and the value the
 * parent holds in the column that relation references. Both are read from TypeORM's metadata and the parent
 * instance, never from the request.
 */
interface ScopeCondition {
  readonly property: string;
  readonly value: ScalarValue;
}

/**
 * The conditions a `.scopeBindings()` lookup adds (docs/v1/http.md › Model binding › Scoped bindings, H14 #163): one
 * per parent model in `scope`, from the relation whose target is the parent's class and its owning join column. The
 * child must relate to its immediate parent (the last entry, path order); an earlier parent adds a condition only when
 * exactly one usable relation exists, and is skipped otherwise (each level was already scoped by its own parent).
 * For the immediate parent, more than one usable relation, a relation that is not many-to-one or an owning one-to-one,
 * a relation with no join column, a relation with a composite join column, a relation declared inside an embedded and a
 * parent property that is not loaded are configuration errors (a lookup that silently ignored the parent would read
 * another parent's row, and one that picked a relation would choose a tenant for the app). A relation named `__proto__`
 * is refused for every parent: the where dictionary would read it as its prototype and drop the filter. An earlier
 * parent is transitive: it adds a condition only when it has one usable relation, and is skipped otherwise. A parent
 * key that is `null` references nothing: `undefined`, which the lookup answers as a miss. Every value must be scalar,
 * so it is bound as a parameter and never becomes SQL (a transformer that hydrates an object is refused).
 */
const scopeConditions = (model: typeof Model, metadata: EntityMetadata, scope: Readonly<Record<string, object>>): ScopeCondition[] | undefined => {
  const conditions: ScopeCondition[] = [];
  const properties = new Set<string>();
  const entries = Object.entries(scope);
  const immediate = entries.length - 1;
  for (const [index, [key, parent]] of entries.entries()) {
    if (parent === null || typeof parent !== "object") {
      throw new ModelError(errors.scopeNotModel(metadata.targetName, key, parent));
    }
    const target = (parent as { constructor?: unknown }).constructor;
    const parentName = targetName(target);
    const matching = (metadata.relations ?? []).filter((entry) => {
      // Match the parent's own class, or a scope value that is an instance of the relation's target (a subclass)
      const relationTarget: unknown = entry.inverseEntityMetadata?.target;
      return relationTarget === target || (typeof relationTarget === "function" && parent instanceof relationTarget);
    });
    // Only the side that holds the join column can filter this table: a one-to-many, a many-to-many or a non-owning
    // one-to-one names the parent's table instead. The immediate parent is required; an earlier one is transitive.
    const usable = matching.filter((entry) => entry.isManyToOne === true || entry.isOneToOneOwner === true);
    if (matching.length === 0 || usable.length === 0) {
      if (index === immediate) {
        throw new ModelError(
          matching.length === 0
            ? errors.scopeNoRelation(metadata.targetName, parentName)
            : errors.scopeRelationKind(metadata.targetName, matching[0]!.propertyName),
        );
      }
      continue;
    }
    if (usable.length > 1) {
      // The scope cannot choose one: using the first would let the app's relation order pick the tenant
      if (index === immediate) {
        throw new ModelError(errors.scopeAmbiguous(metadata.targetName, parentName, usable.map((entry) => entry.propertyName)));
      }
      continue;
    }
    const relation = usable[0]!;
    // A relation declared inside an embedded class lives at `embedded.property`: `join.propertyName` drops the
    // embedded path, so the where key TypeORM receives is not a property of the child (it throws
    // EntityPropertyNotFoundError). This PR builds flat joins only; the immediate parent is a configuration error and
    // an earlier one is transitive.
    const embedded = relation.embeddedMetadata?.propertyName;
    if (embedded !== undefined) {
      if (index === immediate) {
        throw new ModelError(errors.scopeEmbedded(metadata.targetName, relation.propertyName, embedded));
      }
      continue;
    }
    // A relation over `(tenantId, code)` filtered by `tenantId` alone is not a scope: two parents that share the first
    // component would answer the same lookup. Refuse it rather than reading another parent's row.
    if ((relation.joinColumns?.length ?? 0) > 1) {
      if (index === immediate) {
        throw new ModelError(errors.scopeComposite(metadata.targetName, relation.propertyName));
      }
      continue;
    }
    const join = relation.joinColumns?.[0];
    const referenced = join?.referencedColumn;
    if (join === undefined || referenced === undefined) {
      throw new ModelError(errors.scopeNoJoinColumn(metadata.targetName, relation.propertyName));
    }
    // A `__proto__` relation (or join column) would become the where dictionary's prototype, dropping the parent
    // filter (fail-open). It is never a usable scope, for the immediate or an earlier parent.
    if (relation.propertyName === "__proto__" || join.propertyName === "__proto__") {
      throw new ModelError(errors.scopeProto(metadata.targetName));
    }
    if (properties.has(join.propertyName)) {
      // Two scope entries resolved to the same relation: the later value would overwrite the earlier in the where. The
      // immediate parent is a configuration error; an earlier one is transitive and skipped.
      if (index === immediate) {
        throw new ModelError(errors.scopeDuplicate(metadata.targetName, relation.propertyName));
      }
      continue;
    }
    let value: unknown;
    try {
      value = (parent as Record<string, unknown>)[referenced.propertyName];
    } catch {
      // A getter that throws (a hostile Proxy, a computed property) is a configuration error, never SQL text
      throw new ModelError(errors.scopeUnreadable(metadata.targetName, parentName, referenced.propertyName));
    }
    if (value === undefined) {
      throw new ModelError(errors.scopeNotLoaded(metadata.targetName, parentName, referenced.propertyName));
    }
    // A null parent key references no row: no child can match, which is a miss (never `= NULL`, never a dropped filter)
    if (value === null) {
      return undefined;
    }
    // A transformer hydrates the parent value, so the referenced column's to() converts it back before it is bound (as
    // the route key does); a throwing to() is a configuration error, never SQL text
    let bound: unknown = value;
    if (referenced.transformer !== undefined) {
      try {
        bound = transformTo(referenced.transformer, value);
      } catch {
        throw new ModelError(errors.scopeTransformer(metadata.targetName, relation.propertyName));
      }
    }
    if (!isScalarValue(bound)) {
      throw new ModelError(errors.scopeNotScalar(parentName, referenced.propertyName, bound));
    }
    properties.add(join.propertyName);
    conditions.push({ property: join.propertyName, value: bound });
  }
  return conditions;
};

/** A class name for a diagnostic, never trusting a hostile function (a Proxy's `get` can throw). */
const targetName = (target: unknown): string => {
  try {
    const name = (target as { name?: unknown }).name;
    return typeof name === "string" && name !== "" ? name : "the parent model";
  } catch {
    return "the parent model";
  }
};

/**
 * The scoped conditions as `Raw` find operators: each value is a named parameter, so the driver binds it as one value
 * and no parent value (a string with quotes, an object a hostile transformer hydrated) can become SQL text.
 */
const scopeWhere = (conditions: readonly ScopeCondition[]): Record<string, ReturnType<typeof Raw>> => {
  // Null prototype: every condition becomes an own data property, so a `__proto__` key can never be lost to the
  // prototype setter. `scopeConditions` refuses such a relation, and this keeps the writer fail-closed anyway.
  const where: Record<string, ReturnType<typeof Raw>> = Object.create(null);
  conditions.forEach((condition, index) => {
    where[condition.property] = Raw((aliasPath) => `${aliasPath} = :scope${index}`, { [`scope${index}`]: condition.value });
  });
  return where;
};

/**
 * The route-key where clause, plus the scoped conditions (H14 #163): the route key goes through the same `Raw` form, so
 * a transformed key hydrates the same shape as a plain one.
 */
const routeKeyWhere = (property: string, value: ScalarValue, conditions: readonly ScopeCondition[]): Record<string, unknown> => ({
  [property]: Raw((aliasPath) => `${aliasPath} = :routeKey`, { routeKey: value }),
  ...scopeWhere(conditions),
});

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
  conditions: readonly ScopeCondition[] = [],
): Promise<T | null> => {
  const options = {
    // The alias path comes from the entity metadata and TypeORM's query alias, never from the caller's path string
    where: routeKeyWhere(property, value, conditions),
  } as FindOneOptions<BaseEntity>;
  return model.findOne(options) as Promise<T | null>;
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
   * The raw path string is converted to the route key column's type first (or through the column's transformer, whose
   * result is checked against the column's type), and a key that cannot convert or a transformer that throws resolves
   * `null`. The lookup goes through `findOne`, so eager relations and a single row match a plain key.
   *
   * `scope` (H14 #163, `r.scopeBindings()`) scopes the lookup to the models already bound for the route's earlier path
   * params: each is matched through this model's relation to it, with its referenced column value bound as a
   * parameter. A parent that is missing (a `null` key), another parent's child, or no row resolves `null`; a model with
   * no relation to a parent, a relation without an owning join column and a parent value that is not loaded are
   * configuration errors. `scope` must be declared as a plain second parameter: `Function.length` is what the router
   * checks, and a default or rest parameter does not count.
   */
  static findByRouteKey<T extends BaseEntity>(
    this: ModelClass<T>,
    key: string,
    scope?: Readonly<Record<string, object>>,
  ): Promise<T | null>;

  static async findByRouteKey(key: string, scope?: Readonly<Record<string, object>>): Promise<any> {
    const { property, column, driver, metadata } = routeKeyColumn(this);
    // The route key is a path string: a JS caller's other type is a miss, never a coercion or a throw
    if (typeof key !== "string") {
      return null;
    }
    const conditions = scope === undefined || Object.keys(scope).length === 0 ? [] : scopeConditions(this, metadata, scope);
    // A parent key that references no row: no child can match it
    if (conditions === undefined) {
      return null;
    }
    // The route-key condition and a join column cannot be the same column: one where-entry would overwrite the other
    if (conditions.some((condition) => condition.property === property)) {
      throw new ModelError(errors.scopeRouteKey(metadata.targetName, property));
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
    if (column.transformer === undefined && conditions.length === 0) {
      // SQL Server types a plain `time` bind as a `Time` parameter, whose tedious validator runs Date.parse on the
      // string (NaN for time-only text) and rejects it. The raw form keeps the exact text, fractional digits
      // included, and SQL Server converts the untyped parameter to time.
      if (driver === "mssql" && TIME_TYPES.includes(column.type)) {
        return findOneByRouteKey(this, property, routeKey, conditions);
      }
      return this.findOne({ where: { [property]: routeKey } } as FindOneOptions<Model>);
    }
    return findOneByRouteKey(this, property, routeKey, conditions);
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
