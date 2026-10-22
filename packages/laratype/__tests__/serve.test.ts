import { afterEach, describe, expect, it } from "vitest";
import { __laratype_deps, Facade } from "@laratype/core";
import { AppServiceProvider, ServiceProvider } from "@laratype/support";
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

  it("is the facade application until down()", () => {
    const container = Serve.getContainer();
    expect(Facade.getFacadeApplication()).toBe(container);
    Serve.down();
    expect(Facade.getFacadeApplication()).not.toBe(container);
  });
});

describe("Serve.bootProvider", () => {
  afterEach(() => Serve.down());

  it("a failed boot releases what booted and resets the app, so the next boot registers everything once", async () => {
    const log: string[] = [];
    let failing = true;
    class Mw extends AppServiceProvider {
      boot() {
        this.apps.use("*", async (_c, next) => next());
        log.push("mw boot");
      }
      async down() {
        log.push("mw down");
      }
    }
    class Flaky extends ServiceProvider {
      boot() {
        if (failing) throw new Error("boot failed");
      }
    }
    const first = Serve.getInstance();
    await expect(Serve.bootProvider([Mw, Flaky])).rejects.toThrow("boot failed");
    expect(log).toEqual(["mw boot", "mw down"]);
    // the half-booted Hono app and container are gone
    expect(Serve.getInstance()).not.toBe(first);
    failing = false;
    const downs = await Serve.bootProvider([Mw, Flaky]);
    const middleware = Serve.getInstance().routes.filter((r) => r.method === "ALL");
    expect(middleware).toHaveLength(1);
    expect(log).toEqual(["mw boot", "mw down", "mw boot"]);
    for (const down of downs) await down();
    expect(log.filter((l) => l === "mw down")).toHaveLength(2);
  });
});

describe("Serve.stop", () => {
  afterEach(() => Serve.down());

  it("runs every cleanup and resets the app even when a cleanup throws", async () => {
    const log: string[] = [];
    const before = Serve.getInstance();
    const stopping = Serve.stop([
      () => { log.push("a"); throw new Error("a failed"); },
      async () => { log.push("b"); },
    ]);
    await expect(stopping).rejects.toThrow("a failed");
    expect(log).toEqual(["a", "b"]);
    // the next boot gets a fresh Hono app
    expect(Serve.getInstance()).not.toBe(before);
  });

  it("reports several failures together", async () => {
    await expect(Serve.stop([() => { throw new Error("x"); }, () => { throw new Error("y"); }])).rejects.toBeInstanceOf(AggregateError);
  });
});
