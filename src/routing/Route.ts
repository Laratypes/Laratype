import type { RouteOptions } from "../commonType";
import { Context, Hono } from "hono";
import Request from "../request/Request";
import ValidationException from "../exception/ValidationException";
import RequestKernel from "../request/RequestKernel";
import ServiceProvider from "../support/ServiceProvider";



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