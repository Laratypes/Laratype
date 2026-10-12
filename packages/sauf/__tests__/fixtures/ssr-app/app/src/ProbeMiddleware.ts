import { Middleware, type MiddlewareHandler } from "@laratype/http";

// Extends a class from a workspace package: under the broken dist build this
// threw "The superclass is not a constructor" while the module was evaluated.
export default class ProbeMiddleware extends Middleware {
  handle: MiddlewareHandler = async (request, res, next) => {
    return next(request);
  }
}
