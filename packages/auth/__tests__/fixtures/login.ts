// The in-memory Model, guard config and request context of the auth login tests, shared by login.test.ts and attemptDummy.test.ts.
import { expect, vi } from "vitest";
import { Container, depsRegistry } from "@laratype/core";
import { ContextApi } from "@laratype/support";
import { Auth, AuthManager } from "../../src";

/** sha256('secret'), the 0.5 format. */
export const SHA256_SECRET = "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b";

export type Row = { id: number; [key: string]: unknown };

export type FakeOptions = {
  column?: string;
  declared?: string;
  select?: boolean;
  failUpdate?: boolean;
  /** Runs when the rehash update arrives, to model a password change that committed while scrypt ran. */
  beforeUpdate?: () => void;
};

/** The slice of a typeorm Model that the login uses, over rows in memory; the password column is { select: false } by default. */
export const fakeModel = (
  rows: Row[],
  { column = "password", declared = column, select = false, failUpdate = false, beforeUpdate }: FakeOptions = {},
) => {
  const calls = { where: [] as object[], addSelect: [] as string[], update: [] as [unknown, object][] };
  const builders = vi.fn();
  const findOneBy = vi.fn(async () => null);
  class User {
    /** The credential column the model declares: cast() hashes it and attempt() checks it. */
    static readonly passwordField = declared;
    static findOneBy = findOneBy;
    static getRepository() {
      return {
        metadata: {
          primaryColumns: [{ propertyName: "id" }],
          findColumnWithPropertyName: (name: string) =>
            name === column ? { propertyPath: column, isSelect: select } : undefined,
        },
        update: async (criteria: Record<string, unknown>, data: Partial<Row>) => {
          calls.update.push([criteria, data]);
          beforeUpdate?.();
          if (failUpdate) throw new Error("the database is down");
          const row = rows.find((candidate) =>
            Object.entries(criteria).every(([key, value]) => candidate[key as keyof Row] === value),
          );
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
          const row = rows.find((r) => Object.entries(where).every(([key, value]) => r[key as keyof Row] === value));
          return row ? Object.assign(new User(), row) : null;
        },
      };
      return qb;
    }
    static getId(user: Row) {
      return user.id;
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
