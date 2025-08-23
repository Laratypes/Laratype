import { ConfigLoadServiceProvider, DateTimeServiceProvider, getDefaultExports, getProjectPath, importModule, ServiceProvider, EnvLoadServiceProvider } from '@laratype/support';
import { existsSync } from "node:fs";

export const boot = async () => {
  const providerPath = getProjectPath('/config/providers.ts', false);
  let providers: Array<typeof ServiceProvider> = [];
  if(existsSync(providerPath)) {
    const module = await importModule(providerPath);
    providers = getDefaultExports(module) as Array<typeof ServiceProvider>;
  }

  const { RequestKernel, ResponseKernel } = await importModule("@laratype/http") as typeof import("@laratype/http") ?? {};

  const serviceProviderBootstrapped: Array<typeof ServiceProvider> = [
    EnvLoadServiceProvider,
    ConfigLoadServiceProvider,
    DateTimeServiceProvider,
  ];

  if(RequestKernel) {
    serviceProviderBootstrapped.push(RequestKernel);
  }
  
  serviceProviderBootstrapped.push(...providers);

  if(ResponseKernel) {
    serviceProviderBootstrapped.push(ResponseKernel);
  }

  return serviceProviderBootstrapped;
}
