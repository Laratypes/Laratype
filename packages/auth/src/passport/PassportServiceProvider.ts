import passport from "passport";
import { BaseEntity, Model } from "@laratype/database";
//@ts-ignore
// import authenticate from "passport/lib/middleware/authenticate";
import { importModule, ServiceProvider, LaratypeConfig as Config, getProjectPath, getDefaultExports, ContextApi, RedirectStatusCode } from "@laratype/support";
import { randomUUID } from "crypto";
import { type NextHandler, redirect, type Request, type Response } from "@laratype/http";

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

export default class PassportServiceProvider extends ServiceProvider {
  public async boot() {
    const module: Config.Auth = await importModule(getProjectPath('config/auth.ts'))
    const authConfig = getDefaultExports(module)

    const guardType = authConfig.default.guard
    const guard = authConfig.guards[guardType]
    const model: typeof Model = guard.provider

    // TODO: Overwrite this module
    // @ts-ignore
    passport.use(new guard.strategy({
      ...guard.options,
      store: storeManagement,
    }, (issuer: any, profile: any, cb: (err: any, profile: any, info?: any) => void) => {
      
      const result = model.findOneBy({
        [guard.options.usernameField]: issuer,
        [guard.options.passwordField]: profile
      })

      result.then((res: BaseEntity) => {
        if(res) {
          cb(null, res);
          return res;
        }
        cb(null, false, { message: 'Incorrect username or password.' });
      })
      
    }))

    passport.framework({
      initialize,
      authenticate,
    });
  }

}