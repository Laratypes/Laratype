// The in-memory Model, guard config and request context of the auth login tests, shared by login.test.ts and attemptDummy.test.ts.
import { expect, vi } from "vitest";
import { Container, depsRegistry } from "@laratype/core";
import { ContextApi } from "@laratype/support";
import { Auth, AuthManager } from "../../src";

/** sha256('secret'), the 0.5 format. */
export const SHA256_SECRET = "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b";

export type Row = { id: number; [key: string]: unknown };

/** One primary column: `data.region` is a column of an embedded `data` object, as typeorm's `propertyPath` names it. */
export type PrimaryColumnInput = string | { propertyName: string; propertyPath?: string };

export type FakeOptions = {
  column?: string;
  declared?: string;
  select?: boolean;
  failUpdate?: boolean;
  /** Runs when the rehash update arrives, to model a password change that committed while scrypt ran. */
  beforeUpdate?: () => void;
  /** The model's primary columns: `id` by default; more than one is a composite key. */
  primaryColumns?: PrimaryColumnInput[];
};

/** The slice of a typeorm Model that the login uses, over rows in memory; the password column is { select: false } by default. */
export const fakeModel = (
  rows: Row[],
  {
    column = "password",
    declared = column,
    select = false,
    failUpdate = false,
    beforeUpdate,
    primaryColumns = ["id"],
  }: FakeOptions = {},
) => {
  const calls = { where: [] as object[], addSelect: [] as string[], update: [] as [unknown, object][] };
  const builders = vi.fn();
  const findOneBy = vi.fn(async () => null);
  const columns = primaryColumns.map((column) =>
    typeof column === "string" ? { propertyName: column, propertyPath: column } : column,
  );
  /** The value at a primary column's property path: an embed nests its columns (`data.region`). */
  const readPath = (row: unknown, propertyPath: string): unknown =>
    propertyPath.split(".").reduce<unknown>((value, key) => {
      // typeorm's getEntityValueMap() reads a null embed and throws; a missing one drops the map instead
      if (value === null) throw new TypeError(`Cannot read properties of null (reading '${key}')`);
      if (value === undefined) return undefined;
      return (value as Record<string, unknown>)[key];
    }, row);
  /**
   * typeorm 0.3.26's `EntityMetadata.getEntityIdMap()`: every primary column's value, nested for an embed, `undefined`
   * when a column's property is missing (its `getValueMap()` drops the map then), but a null part stays in the map.
   */
  const getEntityIdMap = (row: unknown) => {
    if (!row) return undefined;
    const id: Record<string, unknown> = {};
    for (const column of columns) {
      const propertyPath = column.propertyPath ?? column.propertyName;
      const path = propertyPath.split(".");
      const value = readPath(row, propertyPath);
      if (value === undefined) return undefined;
      let target = id;
      for (const key of path.slice(0, -1)) {
        const nested = (target[key] ?? {}) as Record<string, unknown>;
        target[key] = nested;
        target = nested;
      }
      target[path[path.length - 1]!] = value;
    }
    return id;
  };
  /** Whether a row matches an update criteria, whose composite key nests an embed's columns. */
  const matches = (value: unknown, criteria: Record<string, unknown>): boolean =>
    Object.entries(criteria).every(([key, expected]) =>
      expected !== null && typeof expected === "object"
        ? matches((value as Record<string, unknown> | null | undefined)?.[key], expected as Record<string, unknown>)
        : (value as Record<string, unknown> | null | undefined)?.[key] === expected,
    );
  class User {
    /** The credential column the model declares: cast() hashes it and attempt() checks it. */
    static readonly passwordField = declared;
    static findOneBy = findOneBy;
    static getRepository() {
      return {
        metadata: {
          primaryColumns: columns,
          getEntityIdMap,
          findColumnWithPropertyName: (name: string) =>
            name === column ? { propertyPath: column, isSelect: select } : undefined,
        },
        update: async (criteria: Record<string, unknown>, data: Partial<Row>) => {
          calls.update.push([criteria, data]);
          beforeUpdate?.();
          if (failUpdate) throw new Error("the database is down");
          const row = rows.find((candidate) => matches(candidate, criteria));
          if (!row) return { affected: 0 };
          Object.assign(row, data);
          return { affected: 1 };
        },
      };
    }
    static createQueryBuilder(alias: string) {
      builders();
      let where: Record<string, unknown> = {};
      const qb = {
        where(value: Record<string, unknown>) {
          where = value;
          calls.where.push(value);
          return qb;
        },
        addSelect(selection: string) {
          calls.addSelect.push(selection);
          expect(selection.startsWith(`${alias}.`)).toBe(true);
          return qb;
        },
        async getOne() {
          // A typeorm entity: the login reads the column and the caller keeps the model's identity
          const row = rows.find((r) => matches(r, where));
          return row ? Object.assign(new User(), row) : null;
        },
      };
      return qb;
    }
    static getId(user: Row) {
      // typeorm's BaseEntity.getId(): the id map for a composite key, the value for a single one
      if (columns.length !== 1) return getEntityIdMap(user);
      const only = columns[0]!;
      return readPath(user, only.propertyPath ?? only.propertyName);
    }
  }
  return { User, calls, builders, findOneBy };
};

const options = (custom: Record<string, unknown> = {}) => ({
  usernameField: "email",
  passwordField: "password",
  ...custom,
});

export const configOf = (provider: unknown, custom: Record<string, unknown> = {}) => ({
  default: { guard: "web" },
  guards: {
    web: {
      strategyName: "local",
      strategy: class {},
      options: options(custom),
      provider,
      verification: "jwt",
    },
  },
});

/** Runs `callback` in a request whose container holds an `AuthManager` over `provider`, as RequestKernel does. */
export const inApp = <T>(
  provider: unknown,
  callback: () => Promise<T>,
  custom: Record<string, unknown> = {},
): Promise<T> => {
  const container = new Container({ deps: depsRegistry });
  container.instance(AuthManager, new AuthManager(configOf(provider, custom) as any));
  return ContextApi.run({ container } as any, callback) as unknown as Promise<T>;
};

/** `Auth.guard('web').attempt()`, flattened to the user or `null`, as a caller sees it. */
export const attempt = (provider: unknown, fields: Record<string, any>, custom: Record<string, unknown> = {}) =>
  inApp(provider, async () => {
    const authenticated = await Auth.guard<any>("web").attempt(fields);
    return authenticated ? authenticated.getUser() : null;
  }, custom);
