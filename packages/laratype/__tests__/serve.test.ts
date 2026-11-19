import { afterEach, describe, expect, it } from "vitest";
import { __laratype_deps, Container, depsRegistry, Facade } from "@laratype/core";
import { AppServiceProvider, bootProviders, ContextApi, Hash, Hasher, ServiceProvider } from "@laratype/support";
import Serve from "../src/serve";

class Clock {}

class Greeter {
  constructor(public clock: Clock) {}
}
// What the `laratype:di` transform emits after the class.
__laratype_deps(Greeter, [() => Clock], { params: ["clock"] });

/** A Hasher whose make() is replaced, for the facade tests. */
class Fixed extends Hasher {
  override make() {
    return "fixed";
  }
}

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

  it("down() leaves a facade application set by someone else", () => {
    Serve.getContainer();
    const other = new Container();
    Facade.setFacadeApplication(other);
    Serve.down();
    expect(Facade.getFacadeApplication()).toBe(other);
    Facade.setFacadeApplication(undefined);
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

describe("facade application (D11 #318)", () => {
  afterEach(() => {
    Serve.down();
    Facade.setFacadeApplication(undefined);
  });

  it("getContainer() re-sets the facade application on every call, so provider bindings still apply after a clear", () => {
    const container = Serve.getContainer().bind(Hasher, Fixed);
    // A test afterEach of another suite cleared it while Serve's container lives
    Facade.setFacadeApplication(undefined);
    expect(Serve.getContainer()).toBe(container);
    expect(Facade.getFacadeApplication()).toBe(container);
    expect(Hash.make("secret")).toBe("fixed");
  });

  it("a Hash.fake() made before bootProvider() survives the boot", async () => {
    const fake = new Fixed();
    const restore = Hash.fake(fake);
    await Serve.bootProvider([ServiceProvider]);
    expect(Serve.getContainer().make(Hasher)).toBe(fake);
    expect(Hash.make("secret")).toBe("fixed");
    restore();
    // The undo carried into the app container removes the fake there too
    expect(Hash.make("secret")).not.toBe("fixed");
  });

  it("carries a fake into an app container a bare bootProviders() sets", async () => {
    const app = new Container({ deps: depsRegistry });
    const fake = new Fixed();
    Hash.fake(fake);
    const downs = await bootProviders(app, [ServiceProvider]);
    expect(app.make(Hasher)).toBe(fake);
    for (const down of downs) await down();
    // The bare boot keeps the facade application after a success, as before
    expect(Facade.getFacadeApplication()).toBe(app);
  });

  it("concurrent boots share one container and one facade application", async () => {
    const [first, second] = await Promise.all([
      Serve.bootProvider([ServiceProvider]),
      Serve.bootProvider([ServiceProvider]),
    ]);
    const container = Serve.getContainer();
    expect(Facade.getFacadeApplication()).toBe(container);
    expect(ContextApi.getContainer()).toBe(container);
    for (const down of [...first, ...second]) await down();
  });

  it("ContextApi.getContainer() is the Serve container outside a request, and the facade sees a binding made there", () => {
    const container = Serve.getContainer();
    expect(ContextApi.getContainer()).toBe(container);
    const other = new Fixed();
    ContextApi.getContainer()!.instance(Hasher, other);
    expect(Hash.make("secret")).toBe("fixed");
    const fake = new Fixed();
    const restore = Hash.fake(fake);
    expect(ContextApi.getContainer()!.make(Hasher)).toBe(fake);
    restore();
  });
});
