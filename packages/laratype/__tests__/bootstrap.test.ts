import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigLoadServiceProvider, DateTimeServiceProvider, EnvLoadServiceProvider, peekAppManifest, ServiceProvider, setAppManifest, type AppManifest } from "@laratype/support";
import { register } from "../src/bootstrap";

const { importModule } = vi.hoisted(() => ({ importModule: vi.fn() }));

// Keep the real providers (and appManifest) and replace only the built-package loader `register()` calls by default
vi.mock("@laratype/support", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@laratype/support")>();
  return { ...actual, importModule };
});

class AppProvider extends ServiceProvider {}
class RequestKernelStub extends ServiceProvider {}
class ResponseKernelStub extends ServiceProvider {}
class PassportServiceProviderStub extends ServiceProvider {}

const manifest = (providers?: AppManifest["providers"]): AppManifest => ({
  providers,
  configs: [],
  routes: [],
  commands: [],
  models: [],
  migrations: [],
  seeders: [],
  factories: [],
  modules: [],
});

const appProviders: AppManifest["providers"] = {
  name: "providers",
  path: "app/config/providers.ts",
  load: async () => ({ default: [AppProvider] }),
};

describe("register", () => {
  const previous = peekAppManifest();

  afterEach(() => {
    importModule.mockReset();
    // Leave no manifest for the next file in the worker when this one found none (the store is on globalThis)
    if (previous) setAppManifest(previous);
    else delete (globalThis as { __laratype_manifest?: AppManifest }).__laratype_manifest;
  });

  it("boots the app's providers from the manifest between the framework providers, in register()'s order", async () => {
    setAppManifest(manifest(appProviders));

    const providers = await register(false, {
      framework: {
        RequestKernel: RequestKernelStub,
        ResponseKernel: ResponseKernelStub,
        PassportServiceProvider: PassportServiceProviderStub,
      },
    });

    // The order is the one `sauf dev` boots: config providers, RequestKernel, app providers, Passport, ResponseKernel
    expect(providers).toEqual([
      EnvLoadServiceProvider,
      ConfigLoadServiceProvider,
      DateTimeServiceProvider,
      RequestKernelStub,
      AppProvider,
      PassportServiceProviderStub,
      ResponseKernelStub,
    ]);
  });

  it("leaves the framework providers out when the caller passes none: no import of the built packages", async () => {
    setAppManifest(manifest(appProviders));

    expect(await register(false, { framework: {} })).toEqual([
      EnvLoadServiceProvider,
      ConfigLoadServiceProvider,
      DateTimeServiceProvider,
      AppProvider,
    ]);
  });

  it("loads the built framework packages by default, in boot order", async () => {
    setAppManifest(manifest());
    importModule
      .mockResolvedValueOnce({ RequestKernel: RequestKernelStub, ResponseKernel: ResponseKernelStub })
      .mockResolvedValueOnce({ PassportServiceProvider: PassportServiceProviderStub });

    const providers = await register(false);

    // Serve.bootProvider() calls register() without a framework list: the default path must still boot every provider
    expect(importModule.mock.calls).toEqual([
      ["@laratype/http", { internal: true }],
      ["@laratype/auth", { internal: true }],
    ]);
    expect(providers).toEqual([
      EnvLoadServiceProvider,
      ConfigLoadServiceProvider,
      DateTimeServiceProvider,
      RequestKernelStub,
      PassportServiceProviderStub,
      ResponseKernelStub,
    ]);
  });

  it("returns only the config providers for onlyConfig, without resolving a framework module", async () => {
    setAppManifest(manifest());

    expect(await register(true)).toEqual([
      EnvLoadServiceProvider,
      ConfigLoadServiceProvider,
      DateTimeServiceProvider,
    ]);
  });
});
