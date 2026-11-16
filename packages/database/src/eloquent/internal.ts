import type { EntityMetadata } from "typeorm";

/** The column type of `EntityMetadata.columns`, which TypeORM does not export from its root entry. */
type ColumnMetadata = EntityMetadata["columns"][number];

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
