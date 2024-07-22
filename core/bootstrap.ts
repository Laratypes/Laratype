import config from "../config/config"
import RequestKernel from "./request/RequestKernel";
import ResponseKernel from "./response/ResponsiveKernel";
import ServiceProvider from "./support/ServiceProvider";

export const serviceProviderBootstrapped = [
  RequestKernel,
  ...config.providers,
  ResponseKernel,
] satisfies Array<typeof ServiceProvider>;