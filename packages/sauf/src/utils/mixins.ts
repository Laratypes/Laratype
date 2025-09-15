import { Command } from "@laratype/console";
import { importModule, ServiceProvider } from "@laratype/support";

export class ServiceProviderBootstrapCommand extends Command {

  protected async bootstrapServiceProvider(providers: Array<typeof ServiceProvider>) {
    const { register } = await importModule("laratype") as typeof import("laratype");

    const configServiceProviders = await register(true);
    const serviceProviders = [...configServiceProviders, ...providers];

    for(let Provider of serviceProviders) {
      const handler = new Provider().boot()
      if(handler instanceof Promise) {
        await handler;
      }
    }

  }
}