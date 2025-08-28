import { Hono } from "hono";
import RequestKernel from "../request/Request";
import { ServiceProvider } from "@laratype/support";
import { RouteOptions } from "../contracts/Route";

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
  if (router.method && router.controller) {
    const filteredMiddleware = __filterMiddleware(
      [...(middleware ?? []), ...(router.middleware ?? [])],
      [...(withoutMiddleware ?? []), ...(router.withoutMiddleware ?? [])]
    );
    app[router.method](
      `${path}${router.path}`,
      RequestKernel.handle({
        ...router,
        middleware: filteredMiddleware,
      })
    );
  }

  router.children?.forEach((childRouter) => {
    _createNestedRoute(
      app,
      childRouter,
      path + router.path,
      [...(middleware ?? []), ...(router.middleware ?? [])],
      [...(withoutMiddleware ?? []), ...(router.withoutMiddleware ?? [])],
    );
  });
};

export const createNestedRoute = (router: RouteOptions) => {
  const route = new Hono();
  _createNestedRoute(route, router);
  return route
}

export const defineRouteGroup = (path: string, routeOptions: RouteOptions, ctx: ServiceProvider) => {
  const route =  createNestedRoute(routeOptions);
  ctx.apps.route(path, route);
  return route
}