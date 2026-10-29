import { ConfigLoadServiceProvider, DateTimeServiceProvider, importModule, type ServiceProvider, EnvLoadServiceProvider, type AppServiceProvider, appManifest, loadDefault } from '@laratype/support';

/**
 * The framework providers `register()` adds around the app's list, in boot order. `register()` imports them from the
 * built packages by default; a test that boots the framework from `src` passes the classes it imported itself, so the
 * order still comes from here instead of a copy in the test.
 */
export interface FrameworkProviders {
  readonly RequestKernel?: typeof ServiceProvider;
  readonly ResponseKernel?: typeof ServiceProvider;
  readonly PassportServiceProvider?: typeof ServiceProvider;
}

export interface RegisterOptions {
  /** The framework providers, when the caller already imported them (tests booting from `src`). */
  readonly framework?: FrameworkProviders;
}

/** Loads the framework providers from the built packages, as `sauf dev` and the production entry do. */
async function importFrameworkProviders(): Promise<FrameworkProviders> {
  const { RequestKernel, ResponseKernel } = await importModule("@laratype/http", {
    internal: true
  }) as typeof import("@laratype/http") ?? {};
  const { PassportServiceProvider } = await importModule("@laratype/auth", {
    internal: true
  }) as typeof import("@laratype/auth") ?? {};
  return { RequestKernel, ResponseKernel, PassportServiceProvider };
}

export async function register(onlyConfig: true, options?: RegisterOptions): Promise<Array<typeof ServiceProvider>>;
export async function register(onlyConfig?: false, options?: RegisterOptions): Promise<Array<typeof ServiceProvider | typeof AppServiceProvider>>;
export async function register(onlyConfig?: boolean, options: RegisterOptions = {}): Promise<Array<typeof ServiceProvider | typeof AppServiceProvider>> {
  // app/config/providers.ts, from the app manifest (docs/v1/build.md › Plugin chain)
  const providersEntry = appManifest().providers;
  const providers = providersEntry ? await loadDefault<Array<typeof ServiceProvider>>(providersEntry) : [];

  const serviceProviderBootstrapped: Array<typeof ServiceProvider | typeof AppServiceProvider> = [
    EnvLoadServiceProvider,
    ConfigLoadServiceProvider,
    DateTimeServiceProvider,
  ];

  if(onlyConfig) {
    return serviceProviderBootstrapped as Array<typeof ServiceProvider>;
  }

  const framework = options.framework ?? await importFrameworkProviders();

  if(framework.RequestKernel) {
    serviceProviderBootstrapped.push(framework.RequestKernel);
  }
  
  serviceProviderBootstrapped.push(...providers);

  if(framework.PassportServiceProvider) {
    serviceProviderBootstrapped.push(framework.PassportServiceProvider);
  }

  if(framework.ResponseKernel) {
    serviceProviderBootstrapped.push(framework.ResponseKernel);
  }

  return serviceProviderBootstrapped;
}
