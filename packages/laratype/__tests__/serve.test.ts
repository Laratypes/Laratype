import { afterEach, describe, expect, it } from "vitest";
import { __laratype_deps } from "@laratype/core";
import Serve from "../src/serve";

class Clock {}

class Greeter {
  constructor(public clock: Clock) {}
}
// What the `laratype:di` transform emits after the class.
__laratype_deps(Greeter, [() => Clock], { params: ["clock"] });

describe("Serve.getContainer", () => {
  afterEach(() => Serve.down());

  it("autowires constructor deps from the __laratype_deps registry", () => {
    const greeter = Serve.getContainer().make(Greeter);
    expect(greeter).toBeInstanceOf(Greeter);
    expect(greeter.clock).toBeInstanceOf(Clock);
  });
});
