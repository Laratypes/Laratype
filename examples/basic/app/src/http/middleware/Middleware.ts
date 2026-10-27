import { Passport, passport } from "@laratype/auth";
import { Middleware, type MiddlewareHandler } from "@laratype/http";

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
    // The api guard in app/config/auth.ts carries the google strategy; strategies register under the guard's name
    return (await Passport.authenticate('api', () => {
      return;
    }))(res, next);
  }
}

export class LocalAuthentication extends Middleware {
  handle: MiddlewareHandler = async (request, res, next) => {
    const handler = await Passport.authenticate('web');

    return handler(res, next);
  }
}

export class AdminLocalAuthentication extends Middleware {
  handle: MiddlewareHandler = async (request, res, next) => {
    const handler = await Passport.authenticate('admin');

    return handler(res, next);
  }
}