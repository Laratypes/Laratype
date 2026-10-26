import { ConfigLoadServiceProvider, DateTimeServiceProvider, importModule, type ServiceProvider, EnvLoadServiceProvider, type AppServiceProvider, appManifest, loadDefault } from '@laratype/support';

export async function register(onlyConfig: true): Promise<Array<typeof ServiceProvider>>;
export async function register(onlyConfig?: false): Promise<Array<typeof ServiceProvider | typeof AppServiceProvider>>;
export async function register(onlyConfig?: boolean): Promise<Array<typeof ServiceProvider | typeof AppServiceProvider>> {
  // app/config/providers.ts, from the app manifest (docs/v1/build.md › Plugin chain)
  const providersEntry = appManifest().providers;
  const providers = providersEntry ? await loadDefault<Array<typeof ServiceProvider>>(providersEntry) : [];

  const { RequestKernel, ResponseKernel } = await importModule("@laratype/http", {
    internal: true
  }) as typeof import("@laratype/http") ?? {};
  const { PassportServiceProvider } = await importModule("@laratype/auth", {
    internal: true
  }) as typeof import("@laratype/auth") ?? {};

  const serviceProviderBootstrapped: Array<typeof ServiceProvider | typeof AppServiceProvider> = [
    EnvLoadServiceProvider,
    ConfigLoadServiceProvider,
    DateTimeServiceProvider,
  ];

  if(onlyConfig) {
    return serviceProviderBootstrapped as Array<typeof ServiceProvider>;
  }

  if(RequestKernel) {
    serviceProviderBootstrapped.push(RequestKernel);
  }
  
  serviceProviderBootstrapped.push(...providers);

  if(PassportServiceProvider) {
    serviceProviderBootstrapped.push(PassportServiceProvider);
  }

  if(ResponseKernel) {
    serviceProviderBootstrapped.push(ResponseKernel);
  }

  return serviceProviderBootstrapped;
}
