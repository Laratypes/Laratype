// A contract-only app (no @laratype/auth): GuardRegistry types the guard names, and the user type is unknown.
// Compiled by ../../typecheck.test.ts in its own program, so the link is not filled here.
import { expectTypeOf } from "vitest";
import { defineContract, endpoint } from "@laratype/contract";
import type { GuardName, GuardUser } from "@laratype/contract";

declare module "@laratype/contract" {
  interface GuardRegistry {
    api: true;
    admin: true;
  }
}

expectTypeOf<GuardName>().toEqualTypeOf<"api" | "admin">();
// The contract cannot know the user type without @laratype/auth's link.
expectTypeOf<GuardUser<true>>().toEqualTypeOf<unknown>();
expectTypeOf<GuardUser<"api">>().toEqualTypeOf<unknown>();

defineContract()({ index: endpoint.get("/").auth("api") });
// @ts-expect-error 'web' is not in GuardRegistry
defineContract()({ index: endpoint.get("/").auth("web") });
