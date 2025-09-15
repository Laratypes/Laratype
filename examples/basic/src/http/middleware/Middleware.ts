import { Passport, passport } from "@laratype/auth";
import { Middleware, MiddlewareHandler } from "@laratype/http";

export class EnsureMiddlewareWorking extends Middleware {
  handle: MiddlewareHandler = async (request, res, next) => {
    
    const result = await next(request)

    return result;

  }
}

export class EnsureMiddlewareWorking2 extends Middleware {
  handle: MiddlewareHandler = async (request, res, next) => {
    
    return next(request);
  }
}


export class Web extends Middleware {
  handle: MiddlewareHandler = async (request, res, next) => {
    
    return next(request);
  }
}

export class GoogleAuthentication extends Middleware {
  handle: MiddlewareHandler = async (request, res, next) => {
    return (await Passport.authenticate('google', () => {
      return;
    }))(res, next);
  }
}

export class LocalAuthentication extends Middleware {
  handle: MiddlewareHandler = async (request, res, next) => {
    const handler = await Passport.authenticate('local');

    return handler(res, next);
  }
}