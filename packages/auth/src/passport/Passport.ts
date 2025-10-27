import type { NextHandler, Request, Response } from "@laratype/http";
import passport from "passport";
import { importModule } from "@laratype/support";

export default class Passport {
  static passport: passport.PassportStatic = passport;

  static getPassport(): passport.PassportStatic {
    return this.passport;
  }

  // Convert to express request, make it compatibility with express.js
  static getHttpRequest(req: Request) {
    const newRequest: Record<string, any> = {
      method: req.method(),
      headers: req.headers(),
      query: req.query(),
      body: req.all(),
    }
    
    newRequest.connection = {
      encrypted: req.protocol() === "https:"
    }

    return newRequest;
  }

  static authenticate: passport.Authenticator['authorize'] = async (strategy, options, callback?) => {
    const { ContextApi } = await importModule("@laratype/support", {
      internal: true
    }) as typeof import("@laratype/support");
    const currentRequest = ContextApi.getRequest();
    const expressRequest = this.getHttpRequest(currentRequest);
    return (res: Response, next: NextHandler) => {
      // @ts-ignore
      return this.passport.authenticate(strategy, options, callback)(expressRequest, res, next);
    }
  }
}
