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

    const routes = globalThis.__laratype_routes?.map(routeRow) ?? [];

    if(routes.length === 0) {
      Console.warn("No routes registered.");
      return 0;
    }

    // The Domain column only shows when a Route.api(...).domain() is set
    if(!routes.some(route => route.Domain !== '-')) {
      routes.forEach(route => delete (route as Partial<typeof route>).Domain);
    }

    Console.table(routes)

    return 0;

  }
}

/**
 * One row of the table. Reads both registry shapes: the v2 entries of `Route.api` (name, method, path, endpoint,
 * controller, middleware, scope policies, domain; docs/v1/http.md › Router v2) and the 0.5 `RouteParams`.
 */
export const routeRow = (route: Record<string, any>) => ({
  Method: route.method,
  path: route.path,
  Name: route.name ?? '-',
  Controller: `${route.controller[0].name}::${route.controller[1]}`,
  Middleware: route.middleware?.length ? route.middleware.map((mw: any) => mw.name).join(', ') : '-',
  Policies: Array.isArray(route.policies)
    ? route.policies.length ? route.policies.map((p: any) => `${p.dir || '(root)'}: ${p.policy.name}`).join(', ') : '-'
    : route.can?.length ? route.can.map((mw: any) => {
      return `${mw.ability}{${mw.args.map((arg: any) => arg.name ? arg.name : `/:${arg}`).join(', ')}}`
    }).join(', ') : '-',
  Domain: route.domain ?? '-',
});
