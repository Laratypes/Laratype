import { ConfigLoadServiceProvider, DateTimeServiceProvider, getDefaultExports, getProjectPath, importModule, ServiceProvider, EnvLoadServiceProvider, AppServiceProvider } from '@laratype/support';
import { existsSync } from "node:fs";

export async function register(onlyConfig: true): Promise<Array<typeof ServiceProvider>>;
export async function register(onlyConfig?: false): Promise<Array<typeof ServiceProvider | typeof AppServiceProvider>>;
export async function register(onlyConfig?: boolean): Promise<Array<typeof ServiceProvider | typeof AppServiceProvider>> {
  const providerPath = getProjectPath('/config/providers.ts', false);
  let providers: Array<typeof ServiceProvider> = [];
  if(existsSync(providerPath)) {
    const module = await importModule(providerPath);
    providers = getDefaultExports(module) as Array<typeof ServiceProvider>;
  }

  const { RequestKernel, ResponseKernel } = await importModule("@laratype/http") as typeof import("@laratype/http") ?? {};
  const { PassportServiceProvider } = await importModule("@laratype/auth") as typeof import("@laratype/auth") ?? {};

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
