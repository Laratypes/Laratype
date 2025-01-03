import { Hono } from "hono";
import RequestKernel from "../request/Request";
import { ServiceProvider } from "@laratype/support";
import { RouteOptions } from "../contracts/Route";

const _createNestedRoute = (
  app: Hono,
  router: RouteOptions,
  path: string = '',
  middleware?: RouteOptions['middleware'],
) => {
  if (router.method && router.controller) {
    app[router.method](
      `${path}${router.path}`,
      RequestKernel.handle(router)
    );
  }

  router.children?.forEach((childRouter) => {
    _createNestedRoute(
      app,
      childRouter,
      path + router.path,
      [...(middleware ?? []), ...(router.middleware ?? [])],
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