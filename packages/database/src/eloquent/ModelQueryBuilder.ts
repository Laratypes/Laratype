import {
  Equal,
  In,
  LessThan,
  LessThanOrEqual,
  Like,
  MoreThan,
  MoreThanOrEqual,
  Not,
  type FindOperator,
  type ObjectLiteral,
  type Repository,
  type SelectQueryBuilder,
} from "typeorm";
import ModelError from "../exceptions/ModelError";
import { formatValue, ownColumn, valueType } from "./internal";

/**
 * A property of `T` that holds data, not a method: the columns `where()` and `orderBy()` accept at the type level,
 * so `where('save', ...)` does not compile. Only string keys count: a symbol-keyed brand is not a column.
 */
export type ColumnKey<T> = {
  [K in Extract<keyof T, string>]: T[K] extends (...args: any[]) => any ? never : K;
}[Extract<keyof T, string>];

/** A plain equality filter over the model's columns, the object form of `where()`. */
export type ModelWhere<T> = { [K in ColumnKey<T>]?: Exclude<T[K], undefined> };

/** The comparisons the three-argument `where()` accepts. */
const COMPARISONS = ["=", "!=", "<", "<=", ">", ">=", "like", "not like"] as const;

/** A comparison `where()` maps to a TypeORM `FindOperator`, so a value can never become SQL text. */
export type WhereComparison = (typeof COMPARISONS)[number];

/** The runtime allowlist behind `WhereOperator`, a tuple so the type derives from it. */
const OPERATORS = [...COMPARISONS, "in", "not in"] as const;

/** Every operator the three-argument `where()` accepts. */
export type WhereOperator = (typeof OPERATORS)[number];

/** The direction `orderBy()` accepts; checked at runtime, any case. */
export type OrderDirection = "asc" | "desc";

/** A page of models with plain meta fields: what `paginate()` resolves and http.md › Resources accepts as is. */
export interface Page<T> {
  readonly data: readonly T[];
  readonly total: number;
  readonly perPage: number;
  readonly currentPage: number;
  readonly lastPage: number;
}

/** The largest page size `paginate()` accepts, so a request cannot ask one query for an unbounded page. */
const MAX_PER_PAGE = 100;

/** The runtime allowlist behind `WhereOperator`: an unknown string from a cast or plain JS is refused. */
const isWhereOperator = (value: unknown): value is WhereOperator =>
  typeof value === "string" && (OPERATORS as readonly string[]).includes(value);

/** The largest `in` / `not in` list `where()` accepts: Postgres allows 65,535 parameters, sqlite 32,766. */
const MAX_IN_VALUES = 1000;

/** A value `where()` accepts: something mysql2 binds as one parameter, never as SQL text. */
type ScalarValue = string | number | bigint | boolean | Date | Uint8Array;

/**
 * Whether a value is a scalar `where()` accepts: a string, a finite number, a bigint, a boolean, a valid Date, a
 * Buffer or a Uint8Array (a Buffer is one).
 */
const isScalarValue = (value: unknown): value is ScalarValue =>
  typeof value === "string" ||
  typeof value === "bigint" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value)) ||
  (value instanceof Date && !Number.isNaN(value.getTime())) ||
  value instanceof Uint8Array;

/** The scalar kinds a diagnostic lists. */
const SCALAR_KINDS = "a string, a finite number, a bigint, a boolean, a valid Date, a Buffer or a Uint8Array";

/** The builder's message text, in one place (errors-and-comments.md › Errors). */
const errors = {
  firstArgument: (value: unknown): string =>
    `[@laratype/database] where() takes a column name or a where object, got ${formatValue(value)}`,
  noColumn: (model: string, name: string, method: "where" | "orderBy"): string =>
    `[@laratype/database] ${model} has no column ${formatValue(name)}: ${method}() takes a column property`
    + " of the model",
  operator: (operator: unknown): string =>
    `[@laratype/database] where() takes one of ${OPERATORS.join(", ")}, got ${formatValue(operator)}`,
  arrayOperand: (operator: string, value: unknown): string =>
    `[@laratype/database] where() takes an array for ${formatValue(operator)}, got ${formatValue(value)}`,
  nullishValue: (column: string, value: unknown): string =>
    `[@laratype/database] where() cannot filter ${formatValue(column)} with ${formatValue(value)}:`
    + " IS NULL filters are not part of the v1 surface",
  scalarValue: (column: string, value: unknown): string =>
    `[@laratype/database] where() takes a scalar value for ${formatValue(column)} (${SCALAR_KINDS}),`
    + ` got ${valueType(value)}`,
  inElement: (column: string, operator: string, value: unknown, index: number): string =>
    `[@laratype/database] where() takes scalar elements for ${formatValue(column)} in ${formatValue(operator)}`
    + ` (${SCALAR_KINDS}), got ${valueType(value)} at index ${index}`,
  inLength: (column: string, operator: string, length: number): string =>
    `[@laratype/database] where() takes at most ${MAX_IN_VALUES} elements for ${formatValue(column)}`
    + ` in ${formatValue(operator)}, got ${length}`,
  direction: (direction: unknown): string =>
    `[@laratype/database] orderBy() takes "asc" or "desc", got ${formatValue(direction)}`,
  limit: (count: unknown): string =>
    `[@laratype/database] limit() takes a positive safe integer, got ${formatValue(count)}`,
  page: (page: unknown): string =>
    `[@laratype/database] paginate() takes a page of 1 or more (a safe integer), got ${formatValue(page)}`,
  perPage: (perPage: unknown): string =>
    `[@laratype/database] paginate() takes a perPage of 1 to ${MAX_PER_PAGE}, got ${formatValue(perPage)}`,
  offset: (page: unknown, perPage: unknown): string =>
    `[@laratype/database] paginate() takes a page and perPage whose offset is a safe integer,`
    + ` got page ${formatValue(page)} and perPage ${formatValue(perPage)}`,
};

/** Maps the 3-argument `where()` operator to the `FindOperator` TypeORM parameterizes (never SQL text). */
const toFindOperator = (operator: WhereOperator, value: unknown): FindOperator<unknown> => {
  switch (operator) {
    case "=":
      return Equal(value);
    case "!=":
      return Not(value);
    case "<":
      return LessThan(value);
    case "<=":
      return LessThanOrEqual(value);
    case ">":
      return MoreThan(value);
    case ">=":
      return MoreThanOrEqual(value);
    case "like":
      return Like(value);
    case "not like":
      return Not(Like(value));
    case "in":
      return In(value as readonly unknown[]);
    case "not in":
      return Not(In(value as readonly unknown[]));
  }
};

/**
 * The typed query `Model.query()` returns: a thin facade over one TypeORM `SelectQueryBuilder`, not a second query
 * builder (docs/v1/database.md › Model). Every column, operator and direction is resolved against the entity's
 * TypeORM metadata before TypeORM sees it, and values always travel as parameters.
 */
export default class ModelQueryBuilder<T extends object = object> {
  private readonly repository: Repository<T>;
  private readonly query: SelectQueryBuilder<T>;

  constructor(repository: Repository<T>) {
    this.repository = repository;
    this.query = repository.createQueryBuilder();
  }

  /** Adds an equality filter, a comparison, or the object form; `where()` calls combine with AND. */
  where<K extends ColumnKey<T>>(column: K, value: Exclude<T[K], undefined>): this;
  where<K extends ColumnKey<T>>(column: K, operator: "in" | "not in", value: readonly Exclude<T[K], undefined>[]): this;
  where<K extends ColumnKey<T>>(column: K, operator: WhereComparison, value: Exclude<T[K], undefined>): this;
  where(where: ModelWhere<T>): this;
  where(columnOrWhere: ColumnKey<T> | ModelWhere<T>, ...rest: unknown[]): this {
    if (typeof columnOrWhere !== "string") {
      // A plain JS caller can pass anything: only an object is the object form, and null / a number is refused
      if (typeof columnOrWhere !== "object" || columnOrWhere === null) {
        throw new ModelError(errors.firstArgument(columnOrWhere));
      }
      const conditions: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(columnOrWhere as Record<string, unknown>)) {
        const property = this.column(name, "where");
        this.assertValue(property, value);
        conditions[property] = value;
      }
      this.query.andWhere(conditions as ObjectLiteral);
      return this;
    }

    const column = this.column(columnOrWhere, "where");
    if (rest.length === 1) {
      this.assertValue(column, rest[0]);
      this.query.andWhere({ [column]: rest[0] } as ObjectLiteral);
      return this;
    }

    const [operator, value] = rest;
    // The allowlist, not a pass-through string: a cast or a plain JS caller cannot put SQL in the operator position
    if (!isWhereOperator(operator)) {
      throw new ModelError(errors.operator(operator));
    }
    this.assertDefined(column, value);
    if (operator === "in" || operator === "not in") {
      this.assertInOperand(column, operator, value);
    } else {
      this.assertValue(column, value);
    }
    this.query.andWhere({ [column]: toFindOperator(operator, value) } as ObjectLiteral);
    return this;
  }

  /** Orders by a column property; the direction is checked at runtime, and only `asc` / `desc` reach TypeORM. */
  orderBy<K extends ColumnKey<T>>(column: K, direction: OrderDirection = "asc"): this {
    const property = this.column(column, "orderBy");
    const order = typeof direction === "string" ? direction.toLowerCase() : direction;
    if (order !== "asc" && order !== "desc") {
      throw new ModelError(errors.direction(direction));
    }
    // The alias is the entity's own target name from the metadata, not caller input
    this.query.orderBy(`${this.query.alias}.${property}`, order === "asc" ? "ASC" : "DESC");
    return this;
  }

  /** Caps the rows a `get()` / `first()` reads: a positive safe integer, so no unbounded or negative LIMIT. */
  limit(count: number): this {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new ModelError(errors.limit(count));
    }
    this.query.limit(count);
    return this;
  }

  /** The first row of the query, or `null`. */
  first(): Promise<T | null> {
    return this.query.getOne();
  }

  /** Every row of the query. */
  get(): Promise<T[]> {
    return this.query.getMany();
  }

  /**
   * A plain page of the query (docs/v1/database.md › Model): `page` is 1-based, `perPage` defaults to 15 and is
   * capped at 100, and `lastPage` is 1 for no rows. The page window replaces any earlier `limit()`.
   */
  async paginate(page = 1, perPage = 15): Promise<Page<T>> {
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new ModelError(errors.page(page));
    }
    if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > MAX_PER_PAGE) {
      throw new ModelError(errors.perPage(perPage));
    }
    const offset = (page - 1) * perPage;
    if (!Number.isSafeInteger(offset)) {
      throw new ModelError(errors.offset(page, perPage));
    }
    this.query.offset(offset).limit(perPage);
    // TypeORM's count ignores the page window, so `total` is the full number of matches
    const [data, total] = await this.query.getManyAndCount();
    return { data, total, perPage, currentPage: page, lastPage: Math.max(1, Math.ceil(total / perPage)) };
  }

  /** A nullish value is refused: TypeORM would bind `= NULL`, which never matches, and some drivers reject it. */
  private assertDefined(column: string, value: unknown): void {
    if (value === null || value === undefined) {
      throw new ModelError(errors.nullishValue(column, value));
    }
  }

  /** A where value: no null/undefined, and only a scalar TypeORM binds as a parameter. */
  private assertValue(column: string, value: unknown): void {
    this.assertDefined(column, value);
    if (!isScalarValue(value)) {
      throw new ModelError(errors.scalarValue(column, value));
    }
  }

  /** An in / not in operand: an array of at most 1,000 scalars, with no holes, null or undefined. */
  private assertInOperand(column: string, operator: "in" | "not in", value: unknown): void {
    if (!Array.isArray(value)) {
      throw new ModelError(errors.arrayOperand(operator, value));
    }
    if (value.length > MAX_IN_VALUES) {
      throw new ModelError(errors.inLength(column, operator, value.length));
    }
    for (let index = 0; index < value.length; index++) {
      const element = (value as unknown[])[index];
      this.assertDefined(column, element);
      if (!isScalarValue(element)) {
        throw new ModelError(errors.inElement(column, operator, element, index));
      }
    }
  }

  /** Resolves a caller's column name against the entity metadata; an own column property, or it throws. */
  private column(name: string, method: "where" | "orderBy"): string {
    const column = ownColumn(this.repository.metadata, name);
    if (column === undefined) {
      throw new ModelError(errors.noColumn(this.repository.metadata.targetName, name, method));
    }
    return column.propertyName;
  }
}
