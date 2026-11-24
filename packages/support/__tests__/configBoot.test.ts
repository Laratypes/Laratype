import { afterEach, describe, expect, it } from "vitest";
import { config, Container, Facade } from "@laratype/core";
import { bootProviders, Config, ConfigLoadServiceProvider, setAppManifest } from "@laratype/support";
import { entryLoading as entry, manifestWith as manifest } from "./fixtures/manifest";

const boot = () => bootProviders(new Container(), [ConfigLoadServiceProvider]);

describe("ConfigLoadServiceProvider (K4 #314)", () => {
  const store = globalThis as { __laratype_manifest?: unknown; __laratype_configs?: unknown; __laratype_config?: unknown };

  afterEach(() => {
    delete store.__laratype_manifest;
    delete store.__laratype_configs;
    delete store.__laratype_config;
    Facade.setFacadeApplication(undefined);
  });

  it("loads config.ts first, then the other files together", async () => {
    const calls: string[] = [];
    let bStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      bStarted = resolve;
    });
    // If the other files wait for each other, `a` never resolves: the test times out instead of passing
    const a = entry("a", async () => {
      calls.push("a");
      await started;
      return { default: { a: 1 } };
    });
    const b = entry("b", async () => {
      calls.push("b");
      bStarted();
      return { default: { b: 2 } };
    });
    setAppManifest(manifest([entry("config", async () => {
      calls.push("config");
      return { default: { name: "app" } };
    }), a, b]));

    await boot();
    expect(calls).toEqual(["config", "a", "b"]);
    expect(config("config.name")).toBe("app");
    expect(config("a.a")).toBe(1);
    expect(config("b.b")).toBe(2);
  });

  it("fills the 0.5 Config from config.ts before the other files load", async () => {
    const seen: string[] = [];
    const a = entry("a", async () => {
      seen.push(Config.get(["name"]));
      return { default: {} };
    });
    setAppManifest(manifest([entry("config", async () => ({ default: { name: "app" } })), a]));

    await boot();
    expect(seen).toEqual(["app"]);
  });

  it("fails on the first failing file in file order, not on the first to settle", async () => {
    const a = entry("a", async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      throw new Error("a failed");
    });
    // A later file rejects first; the report still names `a`
    const b = entry("b", async () => {
      throw new Error("b failed");
    });
    setAppManifest(manifest([entry("config", async () => ({ default: {} })), a, b]));

    await expect(boot()).rejects.toThrow("a failed");
    // No partial store: the failure happens before setConfigs, as before
    expect(() => config("config")).toThrow("ran before the configs were loaded");
  });
});
