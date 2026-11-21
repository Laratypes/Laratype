import { afterEach, describe, expect, it, vi } from "vitest";
import { __laratype_deps, Container, depsRegistry, Facade } from "@laratype/core";
import { AppServiceProvider, bootProviders, Hash, Hasher, ServiceProvider } from "@laratype/support";
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

/** A Hasher a provider binds, to check the app binding wins over a dropped fake. */
class OtherHash extends Hasher {
  override make() {
    return "provider";
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

const FALLBACK_WARNED = Symbol.for("laratype.di.fallbackWarned");
const FAKES_DROPPED = Symbol.for("laratype.di.fakesDropped");

describe("facade application (D11 #318)", () => {
  afterEach(() => {
    Serve.down();
    Facade.setFacadeApplication(undefined);
    delete (globalThis as { [FALLBACK_WARNED]?: true })[FALLBACK_WARNED];
    delete (globalThis as { [FAKES_DROPPED]?: true })[FAKES_DROPPED];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** Create the fallback (and its D9 warning) before the counted calls. */
  const warmFallback = (warn: ReturnType<typeof vi.spyOn>): void => {
    Facade.getFacadeApplication();
    warn.mockClear();
  };

  it("re-sets a facade application cleared while the container lives", () => {
    const container = Serve.getContainer().bind(Hasher, Fixed);
    // A test afterEach of another suite cleared it while Serve's container lives
    Facade.setFacadeApplication(undefined);
    expect(Serve.getContainer()).toBe(container);
    expect(Facade.getFacadeApplication()).toBe(container);
    expect(Hash.make("secret")).toBe("fixed");
  });

  it("replaces a facade application an earlier bare boot set", async () => {
    class BindOther extends ServiceProvider {
      register() {
        this.app.bind(Hasher, OtherHash);
      }
    }
    const bare = new Container({ deps: depsRegistry });
    await bootProviders(bare, [BindOther]);
    expect(Facade.getFacadeApplication()).toBe(bare);
    const container = Serve.getContainer();
    expect(Facade.getFacadeApplication()).toBe(container);
    // The bare boot's binding is no longer the facade application's
    expect(Hash.make("secret")).not.toBe("provider");
  });

  it("a pre-boot fake warns once, names the token, and the app binding wins", async () => {
    vi.stubGlobal("__PROD__", false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warmFallback(warn);
    const restore = Hash.fake(new Fixed());
    class BindHash extends ServiceProvider {
      register() {
        this.app.bind(Hasher, OtherHash);
      }
    }
    await Serve.bootProvider([BindHash]);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain("setFacadeApplication() dropped the shared fallback with unrestored fakes: Hasher");
    expect(message).toContain("Make the fake after the boot");
    expect(Hash.make("secret")).toBe("provider");
    // The dropped fallback's restore is a no-op, never a throw
    expect(() => restore()).not.toThrow();
    expect(Hash.make("secret")).toBe("provider");
  });

  it("does not warn when every fake was restored before the boot", async () => {
    vi.stubGlobal("__PROD__", false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warmFallback(warn);
    const restore = Hash.fake(new Fixed());
    restore();
    await Serve.bootProvider([ServiceProvider]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn in production", async () => {
    vi.stubGlobal("__PROD__", true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    Hash.fake(new Fixed());
    await Serve.bootProvider([ServiceProvider]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once per process for dropped fakes", async () => {
    vi.stubGlobal("__PROD__", false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warmFallback(warn);
    Hash.fake(new Fixed());
    await Serve.bootProvider([ServiceProvider]);
    Serve.down();
    Hash.fake(new Fixed());
    await Serve.bootProvider([ServiceProvider]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("concurrent boots share one container and one facade application", async () => {
    const [first, second] = await Promise.all([
      Serve.bootProvider([ServiceProvider]),
      Serve.bootProvider([ServiceProvider]),
    ]);
    const container = Serve.getContainer();
    expect(Facade.getFacadeApplication()).toBe(container);
    for (const down of [...first, ...second]) await down();
  });
});
