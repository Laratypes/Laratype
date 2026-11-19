import type { ObjectLiteral, Repository, SelectQueryBuilder } from "typeorm";
import ModelError from "../exceptions/ModelError";
import {
  type ColumnMetadata,
  formatValue,
  isScalarValue,
  ownColumn,
  transformTo,
  valueType,
} from "./internal";

/**
 * A property of `T` that holds data, not a method: the columns `where()` and `orderBy()` accept at the type level,
 * so `where('save', ...)` does not compile. Only string keys count: a symbol-keyed brand is not a column. The bare
 * name is a row with any string key.
 */
export type ColumnKey<T = any> = {
  [K in Extract<keyof T, string>]: T[K] extends (...args: any[]) => any ? never : K;
}[Extract<keyof T, string>];

/** A plain equality filter over the model's columns, the object form of `where()`; the bare name is any row. */
export type ModelWhere<T = any> = { [K in ColumnKey<T>]?: Exclude<T[K], undefined | null> };

/** The comparisons the three-argument `where()` accepts. */
const COMPARISONS = ["=", "!=", "<", "<=", ">", ">=", "like", "not like"] as const;

/** A comparison `where()` maps to a SQL comparison, so a value can never become SQL text. */
export type WhereComparison = (typeof COMPARISONS)[number];

/** The SQL comparison of each operator: a closed table, never caller text (docs/v1/database.md › Model). */
const SQL_COMPARISONS: Record<WhereComparison, string> = {
  "=": "=",
  "!=": "!=",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  like: "LIKE",
  "not like": "NOT LIKE",
};

/** The runtime allowlist behind `WhereOperator`, a tuple so the type derives from it. */
const OPERATORS = [...COMPARISONS, "in", "not in"] as const;

/** Every operator the three-argument `where()` accepts. */
export type WhereOperator = (typeof OPERATORS)[number];

/** The direction `orderBy()` accepts; checked at runtime, any case. */
export type OrderDirection = "asc" | "desc";

/**
 * A page of models with plain meta fields: what `paginate()` resolves and http.md › Resources accepts as is. The
 * bare name is a page of any row.
 */
export interface Page<T = any> {
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

/** The scalar kinds a diagnostic lists. */
const SCALAR_KINDS = "a string, a finite number, a bigint, a boolean, a valid Date or a Buffer";

/** The builder's message text, in one place (errors-and-comments.md › Errors). */
const errors = {
  firstArgument: (value: unknown): string =>
    `[@laratype/database] where() takes a column name or a where object, got ${
      Array.isArray(value) ? "array" : formatValue(value)
    }`,
  arrayOperand: (operator: string, value: unknown): string =>
    `[@laratype/database] where() takes an array for ${formatValue(operator)}, got ${valueType(value)}`,
  noColumn: (model: string, name: string, method: "where" | "orderBy"): string =>
    `[@laratype/database] ${model} has no column ${formatValue(name)}: ${method}() takes a column property`
    + " of the model",
  operator: (operator: unknown): string =>
    `[@laratype/database] where() takes one of ${OPERATORS.join(", ")}, got ${valueType(operator)}`,
  nullishValue: (column: string, value: unknown): string =>
    `[@laratype/database] where() cannot filter ${formatValue(column)} with ${formatValue(value)}:`
    + " IS NULL filters are not part of the v1 surface",
  scalarValue: (column: string, value: unknown): string =>
    `[@laratype/database] where() takes a scalar value for ${formatValue(column)} (${SCALAR_KINDS}),`
    + ` got ${valueType(value)}`,
  inElement: (column: string, operator: string, value: unknown, index: number): string =>
    `[@laratype/database] where() takes scalar elements for ${formatValue(column)} in ${formatValue(operator)}`
    + ` (${SCALAR_KINDS}), got ${valueType(value)} at index ${index}`,
  transformerValue: (column: string, type: string): string =>
    `[@laratype/database] where() transformer for ${formatValue(column)} returned ${type}:`
    + ` a transformer must return a scalar value (${SCALAR_KINDS})`,
  transformerInElement: (column: string, operator: string, type: string, index: number): string =>
    `[@laratype/database] where() transformer for ${formatValue(column)} returned ${type} at index ${index}`
    + ` in ${formatValue(operator)}: a transformer must return a scalar value (${SCALAR_KINDS})`,
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

/**
 * The typed query `Model.query()` returns: a thin facade over one TypeORM `SelectQueryBuilder`, not a second query
 * builder (docs/v1/database.md › Model). Every column, operator and direction is resolved against the entity's
 * TypeORM metadata before TypeORM sees it, and values always travel as parameters.
 */
export default class ModelQueryBuilder<T extends object = object> {
  private readonly repository: Repository<T>;
  private readonly query: SelectQueryBuilder<T>;
  private parameterCount = 0;

  constructor(repository: Repository<T>) {
    this.repository = repository;
    this.query = repository.createQueryBuilder();
  }

  /** Adds an equality filter, a comparison, or the object form; `where()` calls combine with AND. */
  where<K extends ColumnKey<T>>(column: K, value: Exclude<T[K], undefined | null>): this;
  where<K extends ColumnKey<T>>(
    column: K,
    operator: "in" | "not in",
    value: readonly Exclude<T[K], undefined | null>[],
  ): this;
  where<K extends ColumnKey<T>>(column: K, operator: WhereComparison, value: Exclude<T[K], undefined | null>): this;
  where(where: ModelWhere<T>): this;
  where(columnOrWhere: ColumnKey<T> | ModelWhere<T>, ...rest: unknown[]): this {
    if (typeof columnOrWhere !== "string") {
      // A plain JS caller can pass anything: an array carries no field names, and null / a number is refused
      if (typeof columnOrWhere !== "object" || columnOrWhere === null || Array.isArray(columnOrWhere)) {
        throw new ModelError(errors.firstArgument(columnOrWhere));
      }
      for (const [name, value] of Object.entries(columnOrWhere as Record<string, unknown>)) {
        const property = this.column(name, "where");
        this.assertValue(property.propertyName, value);
        this.pushEquality(property, value);
      }
      return this;
    }

    const column = this.column(columnOrWhere, "where");
    if (rest.length === 1) {
      this.assertValue(column.propertyName, rest[0]);
      this.pushEquality(column, rest[0]);
      return this;
    }

    const [operator, value] = rest;
    // The allowlist, not a pass-through string: a cast or a plain JS caller cannot put SQL in the operator position
    if (!isWhereOperator(operator)) {
      throw new ModelError(errors.operator(operator));
    }
    this.assertDefined(column.propertyName, value);
    if (operator === "in" || operator === "not in") {
      const values = this.inValues(column.propertyName, operator, value);
      this.pushIn(column, operator, values);
    } else {
      this.assertValue(column.propertyName, value);
      this.pushComparison(column.propertyName, operator, this.transformed(column, value));
    }
    return this;
  }

  /** Orders by a column property; the direction is checked at runtime, and only `asc` / `desc` reach TypeORM. */
  orderBy<K extends ColumnKey<T>>(column: K, direction: OrderDirection = "asc"): this {
    const property = this.column(column, "orderBy").propertyName;
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
   * capped at 100, and `lastPage` is 1 for no rows. The page runs on a clone, so its window and any filter added
   * while it waits cannot reach this builder or a concurrent call; the page window replaces an earlier `limit()`.
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
    // One clone, taken before the first await: a where() / limit() on this builder afterwards cannot change the
    // page or its count, and a concurrent paginate() gets its own copy
    const query = this.query.clone().offset(offset).limit(perPage);
    // TypeORM's count ignores the page window, but its lazyCount returns offset + rows for a short page: an empty
    // non-first page would report offset (not the full total), so that one case counts again without the window
    const [data, total] = await query.getManyAndCount();
    const fullTotal = data.length === 0 && offset > 0
      ? await query.offset(undefined).limit(undefined).getCount()
      : total;
    return { data, total: fullTotal, perPage, currentPage: page, lastPage: Math.max(1, Math.ceil(fullTotal / perPage)) };
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

  /**
   * An in / not in operand: an array of at most 1,000 scalars, with no holes, null or undefined. Each element is
   * read once, into a fresh list, so an array getter cannot return a different value to the transform / bind.
   */
  private inValues(column: string, operator: "in" | "not in", value: unknown): unknown[] {
    if (!Array.isArray(value)) {
      throw new ModelError(errors.arrayOperand(operator, value));
    }
    const length = value.length;
    if (length > MAX_IN_VALUES) {
      throw new ModelError(errors.inLength(column, operator, length));
    }
    const values: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const element = value[index];
      this.assertDefined(column, element);
      if (!isScalarValue(element)) {
        throw new ModelError(errors.inElement(column, operator, element, index));
      }
      values.push(element);
    }
    return values;
  }

  /** An operator value with the column's `transformer.to` applied, which must still be a scalar. */
  private transformed(column: ColumnMetadata, value: unknown): unknown {
    if (column.transformer === undefined) return value;
    const transformed = transformTo(column.transformer, value);
    if (!isScalarValue(transformed)) {
      throw new ModelError(errors.transformerValue(column.propertyName, valueType(transformed)));
    }
    return transformed;
  }

  /**
   * Adds `column = :parameter` with the column's transformer applied once. The facade builds the condition itself
   * for every form: TypeORM's object form would apply `transformer.to` again, and an object it returns would reach
   * mysql2 as `key = value` text (docs/v1/database.md › Model).
   */
  private pushEquality(column: ColumnMetadata, value: unknown): void {
    this.pushComparison(column.propertyName, "=", this.transformed(column, value));
  }

  /** Adds `column <comparison> :parameter`; the operator comes from the closed table and the value is bound. */
  private pushComparison(column: string, operator: WhereComparison, value: unknown): void {
    const name = `where_${this.parameterCount++}`;
    this.query.andWhere(`${this.query.alias}.${column} ${SQL_COMPARISONS[operator]} :${name}`, { [name]: value });
  }

  /** Adds `column IN / NOT IN (:...parameter)` with every element transformed once; an empty list matches none/all. */
  private pushIn(column: ColumnMetadata, operator: "in" | "not in", values: readonly unknown[]): void {
    const transformed = values.map((element, index) => {
      if (column.transformer === undefined) return element;
      const value = transformTo(column.transformer, element);
      if (!isScalarValue(value)) {
        throw new ModelError(
          errors.transformerInElement(column.propertyName, operator, valueType(value), index),
        );
      }
      return value;
    });
    if (transformed.length === 0) {
      this.query.andWhere(operator === "in" ? "0=1" : "1=1");
      return;
    }
    const name = `where_${this.parameterCount++}`;
    this.query.andWhere(
      `${this.query.alias}.${column.propertyName} ${operator === "in" ? "IN" : "NOT IN"} (:...${name})`,
      { [name]: transformed },
    );
  }

  /** Resolves a caller's column name against the entity metadata; an own column property, or it throws. */
  private column(name: string, method: "where" | "orderBy"): ColumnMetadata {
    const column = ownColumn(this.repository.metadata, name);
    if (column === undefined) {
      throw new ModelError(errors.noColumn(this.repository.metadata.targetName, name, method));
    }
    return column;
  }
}
