// Type tests for the container-backed registries (D7 #114): the classes and the 0.5 field shapes di.md documents
import { describe, expectTypeOf, it } from "vitest";
import { ModelBindingRegistry, RouteRegistry } from "@laratype/support";

describe("registry types", () => {
  it("current() returns the registry class", () => {
    expectTypeOf(RouteRegistry.current).returns.toEqualTypeOf<RouteRegistry>();
    expectTypeOf(ModelBindingRegistry.current).returns.toEqualTypeOf<ModelBindingRegistry>();
  });

  it("keeps the 0.5 field shapes", () => {
    expectTypeOf<RouteRegistry["routes"]>().toEqualTypeOf<Array<Record<string, any>>>();
    expectTypeOf<ModelBindingRegistry["bindings"]>().toEqualTypeOf<Record<string, any>>();
    expectTypeOf<ModelBindingRegistry["paramModelMap"]>().toEqualTypeOf<Record<string, string>>();
    expectTypeOf<ModelBindingRegistry["models"]>().toEqualTypeOf<Record<string, any>>();
  });

  it("takes the route entries optionally", () => {
    expectTypeOf(new RouteRegistry().routes).toEqualTypeOf<Array<Record<string, any>>>();
    expectTypeOf(new RouteRegistry([{ path: "/x" }]).routes).toEqualTypeOf<Array<Record<string, any>>>();
  });
});
