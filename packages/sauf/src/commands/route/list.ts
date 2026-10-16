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
      Console.warn("The routes marked in Auth serve every request: see the [@laratype/http] Route.api warning.");
    }

    return 0;

  }
}

const NOT_ENFORCED = '(not enforced yet)';

/** `RouteEntry.unenforced`, which @laratype/http decides (the CLI does not import that optional package). */
const authColumn = (route: Record<string, any>) =>
  route.unenforced?.length ? `${route.unenforced.join(', ')} ${NOT_ENFORCED}` : '-';

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
