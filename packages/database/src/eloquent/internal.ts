import type { EntityMetadata } from "typeorm";

/** The column type of `EntityMetadata.columns`, which TypeORM does not export from its root entry. */
type ColumnMetadata = EntityMetadata["columns"][number];

/**
 * A top-level column of the entity whose property is `name` (docs/v1/database.md › Model: own column property
 * names only). An embedded column's leaf name (`address.street`) is not a model property, so it returns `undefined`.
 */
export const ownColumn = (metadata: EntityMetadata, name: string): ColumnMetadata | undefined =>
  metadata.columns.find((column) => column.propertyName === name && column.propertyPath === name);
