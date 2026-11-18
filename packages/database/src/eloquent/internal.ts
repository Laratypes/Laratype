import { types } from "node:util";
import type { EntityMetadata, ValueTransformer } from "typeorm";

/** The column type of `EntityMetadata.columns`, which TypeORM does not export from its root entry. */
export type ColumnMetadata = EntityMetadata["columns"][number];

/**
 * A top-level column of the entity whose property is `name` (docs/v1/database.md › Model: own column property
 * names only). A relation's join column carries `relationMetadata` (its `propertyName` is the relation property for
 * an owning `@ManyToOne`), and an embedded column's leaf name (`address.street`) is not a model property; both
 * return `undefined`.
 */
export const ownColumn = (metadata: EntityMetadata, name: string): ColumnMetadata | undefined =>
  metadata.columns.find(
    (column) =>
      column.propertyName === name && column.propertyPath === name && column.relationMetadata === undefined,
  );

/** The most characters a diagnostic echoes from a value; a longer one is cut with an ellipsis. */
const MAX_VALUE_LENGTH = 100;

/** A diagnostic value: a string is quoted, anything else stringified, cut to 100 characters plus `…`. */
export const formatValue = (value: unknown): string => {
  const text = typeof value === "string" ? JSON.stringify(value) : String(value);
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
};

/**
 * A real `Date`, including one from another realm or a subclass: `util.types.isDate` reads the internal slot, so an
 * object with `Date.prototype` but no slot is not one. It never calls the overridable `getTime()`.
 */
export const isValidDate = (value: unknown): value is Date =>
  types.isDate(value) && Number.isFinite(Date.prototype.getTime.call(value));

/** The type a diagnostic names for a refused value, never the value itself. */
export const valueType = (value: unknown): string => {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number") return Number.isFinite(value) ? "number" : "non-finite number";
  if (types.isDate(value)) return isValidDate(value) ? "Date" : "invalid Date";
  return typeof value;
};

/**
 * Applies a column's `transformer.to` the way TypeORM's `find` does: a transformer array runs in declaration order
 * (docs/v1/database.md › Model).
 */
export const transformTo = (transformer: ValueTransformer | ValueTransformer[], value: unknown): unknown =>
  Array.isArray(transformer)
    ? transformer.reduce<unknown>((transformed, entry) => entry.to(transformed), value)
    : transformer.to(value);
