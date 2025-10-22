import { AppServiceProvider, ServiceProviderType } from "@laratype/support";
import { Console, Command } from "@laratype/console";

export default class RouteListCommand extends Command {
  public static signature = "route:list";

  public static description = "List all registered routes";

  public async providers(providers: typeof AppServiceProvider[]) {
    return providers.filter(provider => {
      return provider.type === ServiceProviderType.ROUTE_PROVIDER || provider.type === ServiceProviderType.CORE_PROVIDER;
    });
  }

  public async handle() {

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

    return 0;

  }
}
