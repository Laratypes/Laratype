import { Hono } from "hono";
import RequestKernel from "../request/Request";
import type { AppServiceProvider } from "@laratype/support";
import { RouteOptions, RouteParams } from "../contracts/Route";

const __filterMiddleware = (allMiddleware: NonNullable<RouteOptions['middleware']>, withoutMiddleware: NonNullable<RouteOptions['middleware']>) => {
  return allMiddleware.filter((middleware) => {
    return !withoutMiddleware.includes(middleware)
  });
}

const _createNestedRoute = (
  app: Hono,
  router: RouteOptions,
  path: string = '',
  middleware?: RouteOptions['middleware'],
  withoutMiddleware?: RouteOptions['middleware']
) => {
  const routes: RouteParams[] = [];
  if (router.method && router.controller) {
    const filteredMiddleware = __filterMiddleware(
      [...(middleware ?? []), ...(router.middleware ?? [])],
      [...(withoutMiddleware ?? []), ...(router.withoutMiddleware ?? [])]
    );
    
    const routePath = `${path}${router.path}`
    app[router.method](
      routePath,
      RequestKernel.handle({
        ...router,
        middleware: filteredMiddleware,
      })
    );

    routes.push({
      method: router.method,
      middleware: filteredMiddleware,
      path: routePath,
      name: router.name,
      controller: router.controller,
    })
  }

  router.children?.forEach((childRouter) => {
    const routeNested = _createNestedRoute(
      app,
      childRouter,
      path + router.path,
      [...(middleware ?? []), ...(router.middleware ?? [])],
      [...(withoutMiddleware ?? []), ...(router.withoutMiddleware ?? [])],
    );

    routes.push(...routeNested);
  });

  return routes;
};

export const createNestedRoute = (base: string, app: Hono, router: RouteOptions) => {
  const routes = _createNestedRoute(app, router, base);
  return routes
}

export const defineRouteGroup = (path: string, routeOptions: RouteOptions, ctx: AppServiceProvider) => {
  const app = new Hono();
  const routes =  createNestedRoute(path, app, routeOptions);
  ctx.apps.route('', app);
  return routes
}
