// A1 #119: a program without the app's `declare module '@laratype/auth'` augmentation keeps the 0.5 types.
// Compiled by ../../typedRegister.test.ts, never run: the `types` program already registers the auth types.
import { expectTypeOf } from "vitest";
import type { Model } from "@laratype/database";
import { Auth, AuthManager, AuthService, AuthVerification } from "@laratype/auth";
import type { Authenticated } from "../../../src/verifications/AuthVerification";
import type { GuardName, RegisteredUser } from "@laratype/auth";

/** Type-level checks only: the body is type-checked but never run. */
const typeOnly = (_fn: () => void) => {};

expectTypeOf<RegisteredUser>().toEqualTypeOf<Model>();
expectTypeOf<GuardName>().toEqualTypeOf<string>();

typeOnly(() => {
  expectTypeOf(Auth.user()).toEqualTypeOf<Authenticated<Model> | null>();
  expectTypeOf(Auth.guard("anything").user()).toEqualTypeOf<Authenticated<Model> | undefined>();
  expectTypeOf(new AuthService().guard("anything").user()).toEqualTypeOf<Authenticated<Model> | undefined>();

  // Any string is a guard name before the app registers its guards
  Auth.guard("anything");
  AuthVerification.guard("anything");
  new AuthManager({ default: { guard: "web" }, guards: {} }).guard("anything");
});
