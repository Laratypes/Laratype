import { importModule, RouteAppServiceProvider, ServiceProviderType } from "@laratype/support";
import { ServiceProviderBootstrapCommand } from "../../utils/mixins";
import { Console } from "@laratype/console";

export default class RouteListCommand extends ServiceProviderBootstrapCommand {
  public static signature = "route:list";

  public static description = "List all registered routes";

  public async handle() {
    
    const { register, Serve } = await importModule("laratype") as typeof import("laratype");

    const vite = await this.initViteDevServer();

    const initServiceProvider = await register(true);
    const serviceProviders = await register();
    
    const routeServiceProviders = serviceProviders.filter(provider => {
      return provider.type === ServiceProviderType.ROUTE_PROVIDER;
    });
    const serviceProvidersSet = new Set([...initServiceProvider, ...routeServiceProviders]);

    const instance = Serve.getInstance()

    for(let Provider of serviceProvidersSet) {
      const handler = new Provider(vite as any, instance).boot()
      if(handler instanceof Promise) {
        await handler;
      }
    }

    const routes = globalThis.__laratype_routes?.map((route) => {
      return {
        Method: route.method,
        path: route.path,
        Name: route.name ?? '-',
        Controller: `${route.controller[0].name}::${route.controller[1]}`,
        Middleware: route.middleware?.length ? route.middleware.map((mw: any) => mw.name).join(', ') : '-',
      }
    }) ?? [];

    if(routes.length === 0) {
      Console.warn("No routes registered.");
      return 0;
    }
    
    Console.table(routes)

    vite.close();

    return 0;

  }
}
