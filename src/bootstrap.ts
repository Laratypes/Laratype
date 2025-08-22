import { RequestKernel, ResponseKernel } from "@laratype/http";
import { ConfigLoadServiceProvider, DateTimeServiceProvider, getDefaultExports, getProjectPath, importModule, ServiceProvider } from '@laratype/support';
import { existsSync } from "node:fs";


export const boot = async () => {
  const providerPath = getProjectPath('/config/providers.ts', false);
  let providers: Array<typeof ServiceProvider> = [];
  if(existsSync(providerPath)) {
    const module = await importModule(providerPath);
    providers = getDefaultExports(module) as Array<typeof ServiceProvider>;
  }
  
  const serviceProviderBootstrapped: Array<typeof ServiceProvider> = [
    ConfigLoadServiceProvider,
    DateTimeServiceProvider,
    RequestKernel,
    ... providers,
    ResponseKernel,
  ];

  return serviceProviderBootstrapped;
}
