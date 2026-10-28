// Type tests (D8 #115): the `Hash` facade forwards to `Hasher`, and `Hash.fake()` takes a Hasher.
import { describe, expectTypeOf, it } from "vitest";
import { Hash, Hasher } from "../src";

/** Type-level checks only: the body is type-checked but never run. */
const typeOnly = (_fn: () => void) => {};

describe("Hash facade", () => {
  it("forwards make() to the Hasher accessor", () => {
    expectTypeOf(Hash.accessor).toEqualTypeOf<typeof Hasher>();
    expectTypeOf(Hash.make).toEqualTypeOf<(value: string) => string>();
  });

  it("takes a Hasher in fake() and returns a restore function", () => {
    expectTypeOf(Hash.fake(new Hasher())).toEqualTypeOf<() => void>();
  });

  it("rejects a fake that is not a Hasher", () => {
    typeOnly(() => {
      // @ts-expect-error the fake must implement Hasher.make()
      Hash.fake({});
      // @ts-expect-error make() takes a string
      Hash.make(1);
    });
  });
});
