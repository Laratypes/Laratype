// Type tests for the typed Register (A1 #119): run by `bunx vitest run --project types`.
import { describe, expectTypeOf, test } from "vitest";
import { Model } from "@laratype/database";
import type { TypedMiddleware } from "@laratype/http";
import { Auth, AuthManager, AuthService, AuthVerification, auth } from "../src";
import type { Authenticated } from "../src/verifications/AuthVerification";
import type { GuardName, GuardUser, RegisteredUser } from "../src";
import type { GuardName as ContractGuardName, GuardUser as ContractGuardUser, AuthRegisterLink } from "@laratype/contract";

class User extends Model {
  id!: number;
}

class Admin extends Model {
  id!: number;
  role!: "admin";
}

// The app's registration: what `declare module` in app code looks like. It applies to the whole `types` program,
// so this is the only type test that registers the auth types.
declare module "@laratype/auth" {
  interface Register {
    user: User;
    guards: {
      web: true;
      api: true;
      admin: { user: Admin };
    };
  }
}

/** Type-level checks only: the body is type-checked but never run. */
const typeOnly = (_fn: () => void) => {};

describe("Register (A1 #119)", () => {
  test("reads the registered user and guard names", () => {
    expectTypeOf<RegisteredUser>().toEqualTypeOf<User>();
    expectTypeOf<GuardName>().toEqualTypeOf<"web" | "api" | "admin">();
  });

  test("the per-guard user type comes from the guard's registry value (A2 #120)", () => {
    expectTypeOf<GuardUser<true>>().toEqualTypeOf<User>();
    expectTypeOf<GuardUser<"web">>().toEqualTypeOf<User>();
    expectTypeOf<GuardUser<"admin">>().toEqualTypeOf<Admin>();
    // The contract reads the same link, without importing auth
    expectTypeOf<ContractGuardName>().toEqualTypeOf<"web" | "api" | "admin">();
    expectTypeOf<ContractGuardUser<true>>().toEqualTypeOf<User>();
    expectTypeOf<ContractGuardUser<"admin">>().toEqualTypeOf<Admin>();
    // The augmentation @laratype/auth writes on import
    expectTypeOf<AuthRegisterLink>().toHaveProperty("user");
    expectTypeOf<AuthRegisterLink["guards"]>().toEqualTypeOf<{ web: User; api: User; admin: Admin }>();
  });

  test("before a registration the 0.5 types stay", () => {
    expectTypeOf<RegisteredUser<{}>>().toEqualTypeOf<Model>();
    expectTypeOf<GuardName<{}>>().toEqualTypeOf<string>();
  });

  test("Auth.user() is typed by the registered user, with no type argument", () => {
    typeOnly(() => {
      expectTypeOf(Auth.user()).toEqualTypeOf<Authenticated<User> | null>();
      expectTypeOf(new AuthService().user()).toEqualTypeOf<Authenticated<User> | null>();
      expectTypeOf(Auth.user<User>()).toEqualTypeOf<Authenticated<User> | null>();
    });
  });

  test("the guard comes back with the registered user", () => {
    typeOnly(() => {
      expectTypeOf(Auth.guard("web").user()).toEqualTypeOf<Authenticated<User> | undefined>();
      expectTypeOf(Auth.guard("web").attempt({})).toEqualTypeOf<Promise<false | Authenticated<User>>>();
      expectTypeOf(new AuthService().guard("web").user()).toEqualTypeOf<Authenticated<User> | undefined>();
    });
  });

  test("login keeps the user it is given", () => {
    typeOnly(() => {
      expectTypeOf(Auth.login(new User())).toEqualTypeOf<Authenticated<User>>();
    });
  });

  test("negatives", () => {
    typeOnly(() => {
      // @ts-expect-error the app registered web, api and admin
      Auth.guard("nope");
      // @ts-expect-error the app registered web, api and admin
      new AuthService().guard("nope");
      // @ts-expect-error the app registered web, api and admin
      AuthVerification.guard("nope");
      // @ts-expect-error the app registered web, api and admin
      new AuthManager({ default: { guard: "web" }, guards: {} }).guard("nope");
    });
  });
});

describe("auth() middleware (A2 #120)", () => {
  test("no argument runs and types the default guard", () => {
    typeOnly(() => {
      expectTypeOf(auth()).toEqualTypeOf<TypedMiddleware<{ user: User }>>();
    });
  });

  test("a guard argument types that guard's user", () => {
    typeOnly(() => {
      expectTypeOf(auth(true)).toEqualTypeOf<TypedMiddleware<{ user: User }>>();
      expectTypeOf(auth("web")).toEqualTypeOf<TypedMiddleware<{ user: User }>>();
      expectTypeOf(auth("admin")).toEqualTypeOf<TypedMiddleware<{ user: Admin }>>();
    });
  });

  test("a guard name is an argument, never a type argument alone", () => {
    typeOnly(() => {
      // @ts-expect-error auth<"admin">() would run the default guard while typing ctx.user as Admin
      auth<"admin">();
    });
  });

  test("negatives", () => {
    typeOnly(() => {
      // @ts-expect-error 'nope' is not one of the registered guards
      auth("nope");
      // @ts-expect-error '__proto__' is not one of the registered guards
      auth("__proto__");
      // @ts-expect-error a long string is a string, and only the registered guard names are accepted
      auth("a".repeat(200));
      // @ts-expect-error a lookalike with a Cyrillic "а" is not the registered "admin"
      auth("аdmin");
      // @ts-expect-error the guard is true or a guard name, never a number
      auth(1);
      // @ts-expect-error the guard is true or a guard name, never NaN
      auth(Number.NaN);
      // @ts-expect-error the guard is true or a guard name, never Infinity
      auth(Infinity);
      // @ts-expect-error the guard is true or a guard name, never null
      auth(null);
      // @ts-expect-error the guard is true or a guard name, never undefined: the guard is required
      auth(undefined);
      // @ts-expect-error the guard is true or a guard name, never an object
      auth({});
      // @ts-expect-error the guard is true or a guard name, never an array-like object
      auth({ length: 1e9 });
      // @ts-expect-error a control character is not a guard name
      auth("\u0000");
      // @ts-expect-error a lone surrogate is not a guard name
      auth("\uD800");
    });
  });
});
