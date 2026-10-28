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

    // The "Not enforced" and Domain columns only show when a route has a value
    for (const column of ['Not enforced', 'Domain'] as const) {
      if(!routes.some(route => route[column] !== '-')) {
        routes.forEach(route => delete (route as Partial<typeof route>)[column]);
      }
    }

    Console.table(routes)

    if(routes.some(route => route['Not enforced'] !== undefined && route['Not enforced'] !== '-')) {
      Console.warn("The routes with a \"Not enforced\" value skip those checks: see the [@laratype/http] Route.api warning.");
    }

    return 0;

  }
}

/** `RouteEntry.unenforced` (auth, authorize, validation), which @laratype/http decides (the CLI does not import that optional package). */
const notEnforcedColumn = (route: Record<string, any>) =>
  route.unenforced?.length ? route.unenforced.join(', ') : '-';

/**
 * One row of the table. Reads both registry shapes: the v2 entries of `Route.api` (name, method, path, endpoint,
 * controller, middleware, scope policies, the contract policy, domain; docs/v1/http.md › Router v2, and its ad-hoc
 * routes) and the 0.5 `RouteParams`.
 */
export const routeRow = (route: Record<string, any>) => ({
  Method: route.method,
  path: route.path,
  Name: route.name ?? '-',
  // An ad-hoc Route.api route (`r.get('/health', () => 'ok')`) has a handler, not a controller
  Controller: route.controller ? `${route.controller[0].name}::${route.controller[1]}` : 'Closure',
  // A 0.5 middleware class has a name; a `defineMiddleware()` value names its handle (H6 #117)
  Middleware: route.middleware?.length ? route.middleware.map((mw: any) => mw.name || mw.handle?.name || 'middleware').join(', ') : '-',
  Policies: Array.isArray(route.policies)
    ? [
      ...route.policies.map((p: any) => `${p.dir || '(root)'}: ${p.policy.name}`),
      ...(route.policy ? [`contract: ${route.policy.name}`] : []),
    ].join(', ') || '-'
    : route.can?.length ? route.can.map((mw: any) => {
      return `${mw.ability}{${mw.args.map((arg: any) => arg.name ? arg.name : `/:${arg}`).join(', ')}}`
    }).join(', ') : '-',
  'Not enforced': notEnforcedColumn(route),
  Domain: route.domain ?? '-',
});
