import { cwd } from 'node:process';
import RequestKernel from "./request/RequestKernel";
import ResponseKernel from "./response/ResponsiveKernel";
import ServiceProvider from "./support/ServiceProvider";
import { ConfigOptions } from './commonType';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const getConfigPath = () => {
  const fileUri = path.resolve(`${cwd()}/config/config.ts`);
  const fileConfig = pathToFileURL(fileUri).href;
  return fileConfig;
}

const getDefaultExports = (module: any) => {
  return module.default;
}

export const boot = async () => {
  const module = await import(getConfigPath());
  const config = getDefaultExports(module) as ConfigOptions;
  
  const serviceProviderBootstrapped = [
    RequestKernel,
    ...config.providers,
    ResponseKernel,
  ] satisfies Array<typeof ServiceProvider>;

  return serviceProviderBootstrapped;
}
