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

    // The Auth and Domain columns only show when a route has a value
    for (const column of ['Auth', 'Domain'] as const) {
      if(!routes.some(route => route[column] !== '-')) {
        routes.forEach(route => delete (route as Partial<typeof route>)[column]);
      }
    }

    Console.table(routes)

    if(routes.some(route => route.Auth?.endsWith(NOT_ENFORCED))) {
      Console.warn("auth and authorize are not enforced yet (planned → #105, #121): the routes marked in Auth serve every request.");
    }

    return 0;

  }
}

const NOT_ENFORCED = '(not enforced yet)';

/** The resolved auth of a v2 entry, marked as not enforced until #105 / #121. */
const authColumn = (route: Record<string, any>) => {
  const caps = [route.auth ? 'auth' : '', route.authorize ? 'authorize' : ''].filter(Boolean);
  return caps.length ? `${caps.join(', ')} ${NOT_ENFORCED}` : '-';
};

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
  Auth: authColumn(route),
  Domain: route.domain ?? '-',
});
