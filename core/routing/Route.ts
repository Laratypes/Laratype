import type { RouteOptions } from "..";
import { Context, Hono } from "hono";
import Request from "../request/Request";
import ValidationException from "../exception/ValidationException";

const controllerKernel = (c: NonNullable<RouteOptions['controller']>) => {
  return (ctx: Context, req: any | undefined) => {
    
    const controller = new c.self.constructor
    const method = c.invoke
    if(typeof controller[method] === "function") {
      // handle req
      return controller[method](ctx, req)
    }
    else
      console.error(`Invoke function expected: function, but got ${typeof controller[method]}`);
    
    return ctx.json({
      error: "Something went wrong!",
    }, 500)
  }
}

const kernel = (routeOption: RouteOptions) => {
  return async (ctx: Context) => {
    let request
    if(routeOption.request) {
      const requestInstance = new routeOption.request();
      const result = await requestInstance.validate(ctx)
      if(result.isError) throw new ValidationException({
        errors: result.errors,
      })
    }
    return controllerKernel(routeOption.controller)(ctx, request)
  }
}

const _createNestedRouter = (
  app: Hono,
  router: RouteOptions,
  path: string = '',
  middleware?: RouteOptions['middleware'],
) => {
  if (router.method && router.controller) {
    app[router.method](
      `${path}${router.path}`,
      kernel(router)
    );
  }

  router.children?.forEach((childRouter) => {
    _createNestedRouter(
      app,
      childRouter,
      path + router.path,
      [...(middleware ?? []), ...(router.middleware ?? [])],
    );
  });
};

export const createNestedRouter = (router: RouteOptions) => {
  const route = new Hono();
  _createNestedRouter(route, router);
  return route
}

