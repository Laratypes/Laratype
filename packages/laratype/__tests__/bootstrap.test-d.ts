import { describe, expectTypeOf, it } from "vitest";
import { ServiceProvider } from "@laratype/support";
import type { AppServiceProvider } from "@laratype/support";
import { register } from "../src/bootstrap";
import type { FrameworkProviders, RegisterOptions } from "../src/bootstrap";

/** Type-level checks only: the body is type-checked but never run. */
const typeOnly = (_fn: () => void) => {};

describe("register types", () => {
  it("narrows the result by onlyConfig", () => {
    typeOnly(() => {
      expectTypeOf(register(true)).toEqualTypeOf<Promise<Array<typeof ServiceProvider>>>();
      expectTypeOf(register()).toEqualTypeOf<Promise<Array<typeof ServiceProvider | typeof AppServiceProvider>>>();
      expectTypeOf(register(false, { framework: {} })).toEqualTypeOf<Promise<Array<typeof ServiceProvider | typeof AppServiceProvider>>>();
    });
  });

  it("accepts framework providers, partial included", () => {
    typeOnly(() => {
      const framework: FrameworkProviders = { RequestKernel: ServiceProvider };
      const options: RegisterOptions = { framework };
      expectTypeOf(register(false, options)).toEqualTypeOf<Promise<Array<typeof ServiceProvider | typeof AppServiceProvider>>>();
    });
  });
});
