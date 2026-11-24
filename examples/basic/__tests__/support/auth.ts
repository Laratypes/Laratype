import { AuthManager } from "@laratype/auth";
import type { Container } from "@laratype/core";
import { Hash, ModelBindingRegistry } from "@laratype/support";
import Admin from "../../app/models/Admin";
import User from "../../app/models/User";
import { parseRouteId } from "../../app/services/routeId";

/**
 * The no-MySQL auth seam for the e2e suite: after the real boot, swap the app container's `AuthManager` for one whose
 * guards verify real JWTs against in-memory provider models. It replaces only the provider's user lookup: the real
 * `TokenGuard`, the real JWT signing/verification, the contract auth step and the policy chain run unchanged.
 */

class MemoryUser extends User {
  static rows: MemoryUser[] = [];
}

class MemoryAdmin extends Admin {
  static rows: MemoryAdmin[] = [];
}

const primaryColumn = { propertyName: "id" };

const repository = () => ({
  metadata: {
    primaryColumns: [primaryColumn],
    findColumnWithPropertyName: (name: string) =>
      name === "password" ? { propertyPath: "password", isSelect: false } : undefined,
    getEntityIdMap: (row: { id: number }) => ({ id: row.id }),
  },
  update: async () => ({ affected: 1 }),
});

const queryBuilder = (rows: () => object[]) => {
  let where: Record<string, unknown> = {};
  const builder = {
    where(criteria: Record<string, unknown>) {
      where = criteria;
      return builder;
    },
    addSelect() {
      return builder;
    },
    async getOne() {
      return rows().find((row) =>
        Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value),
      ) ?? null;
    },
  };
  return builder;
};

// The static side TokenGuard reads (verify: findOneBy; attempt: createQueryBuilder + the password column metadata);
// only the row lookup is in memory. `Object.assign` keeps the inherited TypeORM statics' declared types intact.
Object.assign(MemoryUser, {
  getRepository: repository,
  findOneBy: async (where: { id?: unknown }) => MemoryUser.rows.find((row) => row.id === where.id) ?? null,
  createQueryBuilder: () => queryBuilder(() => MemoryUser.rows),
});

Object.assign(MemoryAdmin, {
  getRepository: repository,
  findOneBy: async (where: { id?: unknown }) => MemoryAdmin.rows.find((row) => row.id === where.id) ?? null,
  createQueryBuilder: () => queryBuilder(() => MemoryAdmin.rows),
});

let passwordHash: string | undefined;

const hash = () => (passwordHash ??= Hash.make("secret"));

export interface MemoryAuth {
  /** Puts the app container's real `AuthManager` binding back. */
  readonly restore: () => void;
  readonly user: (id?: number) => MemoryUser;
  readonly admin: (id?: number) => MemoryAdmin;
  readonly issue: (guard: "web" | "admin", user: MemoryUser | MemoryAdmin, expiresIn?: number) => Promise<string>;
}

export interface MemoryAuthOptions {
  /** `"user"` authenticates a User principal through the admin guard (the policy-chain 403 test). */
  readonly adminProvider?: "admin" | "user";
}

/**
 * The no-DB model-binding seam: `/api/admin/admins/:admin` resolves `Admin.findByRouteKey`, so the suite replaces that
 * lookup with the rows of `swapMemoryAuth`'s `admin()` factory. The route resolver, policy and response path are real.
 */
export const swapAdminLookup = (): { restore: () => void } => {
  const original = Admin.findByRouteKey;
  Object.assign(Admin, {
    findByRouteKey: async (raw: string) => {
      const id = parseRouteId(raw);
      return id === null ? null : MemoryAdmin.rows.find((row) => row.id === id) ?? null;
    },
  });
  return {
    restore: () => {
      Object.assign(Admin, { findByRouteKey: original });
    },
  };
};

export const swapMemoryAuth = (app: Container, options: MemoryAuthOptions = {}): MemoryAuth => {
  MemoryUser.rows = [];
  MemoryAdmin.rows = [];

  const registry = app.make(ModelBindingRegistry);
  registry.models.MemoryUser = MemoryUser;
  registry.models.MemoryAdmin = MemoryAdmin;

  const config = {
    default: { guard: "web" },
    guards: {
      web: { provider: MemoryUser, verification: "jwt" },
      admin: { provider: options.adminProvider === "user" ? MemoryUser : MemoryAdmin, verification: "jwt" },
    },
  } as unknown as ConstructorParameters<typeof AuthManager>[0];

  const manager = new AuthManager(config);
  const restore = app.swap(AuthManager, manager);

  return {
    restore,
    user: (id = 1) => {
      const user = new MemoryUser();
      Object.assign(user, {
        id,
        email: `user${id}@example.com`,
        firstName: "Ada",
        lastName: "Lovelace",
        age: 36,
        isActive: true,
      });
      // The real column is `select: false`: non-enumerable keeps it readable by TokenGuard.attempt and out of JSON.
      Object.defineProperty(user, "password", { value: hash(), writable: true, configurable: true });
      MemoryUser.rows.push(user);
      return user;
    },
    admin: (id = 1) => {
      const admin = new MemoryAdmin();
      Object.assign(admin, {
        id,
        email: `admin${id}@example.com`,
        firstName: "Grace",
        lastName: "Hopper",
        age: 45,
      });
      Object.defineProperty(admin, "password", { value: hash(), writable: true, configurable: true });
      MemoryAdmin.rows.push(admin);
      return admin;
    },
    issue: (guard, user, expiresIn = 3600) =>
      manager.guard(guard).issueToken(user, {
        name: "Test Token",
        abilities: "*",
        expiresIn,
      }),
  };
};
