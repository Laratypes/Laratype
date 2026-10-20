import { importModule } from "@laratype/support";

export const DATABASE_MISSING = "Database package is not installed. Please install it with 'npm install @laratype/database' or 'yarn add @laratype/database'";

/**
 * `@laratype/database`, for the `db:*` commands. `importModule()` logs a failed import and returns `undefined` instead
 * of throwing, so the result is checked: a missing package gives the install hint, not a `TypeError`.
 */
export async function importDatabase(): Promise<typeof import("@laratype/database")> {
  let database: typeof import("@laratype/database") | undefined;
  try {
    database = await importModule("@laratype/database", {
      internal: true
    });
  }
  catch {
    database = undefined;
  }
  if (!database?.DatabaseServiceProvider) {
    throw new Error(DATABASE_MISSING);
  }
  return database;
}
