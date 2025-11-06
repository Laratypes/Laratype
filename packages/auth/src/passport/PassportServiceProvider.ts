import passport from "passport";
import { BaseEntity, Model } from "@laratype/database";
//@ts-ignore
// import authenticate from "passport/lib/middleware/authenticate";
import { importModule, ServiceProvider, LaratypeConfig as Config, getProjectPath, getDefaultExports, ContextApi, RedirectStatusCode } from "@laratype/support";
import { randomUUID } from "crypto";
import { type NextHandler, redirect, type Request, type Response } from "@laratype/http";
import Authentication from "./Authentication";

class StoreManagement {
  public store(req: Request, ctx: any, appState: any, meta: any, cb: (err: any, id: string) => void) {
    cb(null, randomUUID());
  }
}

const storeManagement = new StoreManagement();

const authenticate = (
  passport: any,
  name: string | string[], _options?: any, _callback?: (...args: any[]) => any
) => {
  let callback = _callback;
  let options = _options || {};
  if (typeof _options === 'function') {
    callback = _options;
    options = {};
  }
  return (req: Request, res: Response, next: NextHandler) => {
    return new Promise((resolve) => {
      const strategy = passport._strategy(name);
      const login = (user: unknown) => {
        ContextApi.setUser(user);
      }

      strategy.success = function (user: any, info: any) {
        login(user);
        if (callback) {
          return resolve(callback(user, info));
        }
        resolve(next(req));
      }

      strategy.error = function (err: any) {
        if (callback) {
          return resolve(callback(err));
        }

        resolve(next(err));
      }

      strategy.fail = function(challenge: any, status: any) {
        if (typeof challenge == 'number') {
          status = challenge;
          challenge = undefined;
        }
        resolve({ challenge: challenge, status: status });
      };

      strategy.redirect = function(url: string, status: RedirectStatusCode) {
        resolve(redirect(url, status));
      };

      strategy.authenticate(req, options);

    })
  }
};

const initialize = (passport: any, options: any) => {
  passport._sm = new StoreManagement();

  return (...args: any) => passport;
}

export class GuardStore {

  static auth: Config.Auth;
  static ModelVerify: any;

  public static getAuthConfig() {
    return this.auth;
  }

  public static getGuards() {
    const auth = this.getAuthConfig();

    return auth.guards;
  }

  public static setAuthConfig(authConfig: Config.Auth) {
    this.auth = authConfig;
  }

  public static getModelVerify() {
    return this.ModelVerify;
  }

  public static setModelVerify(model: any) {
    this.ModelVerify = model;
  }
  
}

export default class PassportServiceProvider extends ServiceProvider {

  protected handleLocalStrategy(guard: any, username: string, password: string, cb: (err: any, profile: any, info?: any) => void) {
    const result = Authentication.login(guard, {
      [guard.options.usernameField]: username,
      [guard.options.passwordField]: password,
    });

    result.then((res: BaseEntity) => {
      if(res) {
        cb(null, res);
        return res;
      }
      cb(null, false, { message: 'Incorrect username or password.' });
    })
  }

  public async boot() {
    const module: Config.Auth = await importModule(getProjectPath('config/auth.ts'))
    const authConfig = getDefaultExports(module)
    GuardStore.setAuthConfig(authConfig);
    try {
      const { default: model } = await importModule(getProjectPath("src/models/PersonalAccessToken.ts"));
      GuardStore.setModelVerify(model);
    }
    finally {
    }

    for (const guardName in authConfig.guards) {
      const guard = authConfig.guards[guardName];

      // TODO: Overwrite this module
      // @ts-ignore
      passport.use(guardName, new guard.strategy({
        ...guard.options,
        store: storeManagement,
      }, (issuer: any, profile: any, cb: (err: any, profile: any, info?: any) => void) => {
        if(guard.strategyName !== 'local') {
          // Handle other strategies
          cb(null, false, { message: 'Strategy not implemented' });
          return;
        }

        this.handleLocalStrategy(guard, issuer, profile, cb);
      }))    
    }

    passport.framework({
      initialize,
      authenticate,
    });
  }

}
