import { Middleware, MiddlewareHandler } from "@laratype/http";

export class EnsureMiddlewareWorking extends Middleware {
  handle: MiddlewareHandler = async (request, next) => {
    
    const result = await next(request)

    return result;

  }
}

export class EnsureMiddlewareWorking2 extends Middleware {
  handle: MiddlewareHandler = async (request, next) => {
    
    return next(request);
  }
}


export class Web extends Middleware {
  handle: MiddlewareHandler = async (request, next) => {
    
    return next(request);
  }
}
