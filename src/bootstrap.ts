import { RequestKernel, ResponseKernel } from "@laratype/http";
import { ConfigLoadServiceProvider, DateTimeServiceProvider, getDefaultExports, getProjectPath, ServiceProvider } from '@laratype/support';

export const boot = async () => {
  const module = await import(getProjectPath('/config/providers.ts'));
  const providers = getDefaultExports(module) as Array<typeof ServiceProvider>;
  
  const serviceProviderBootstrapped: Array<typeof ServiceProvider> = [
    ConfigLoadServiceProvider,
    DateTimeServiceProvider,
    RequestKernel,
    ...providers,
    ResponseKernel,
  ];

  return serviceProviderBootstrapped;
}
