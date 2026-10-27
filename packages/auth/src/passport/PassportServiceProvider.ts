import passport from "passport";
import type { Model } from "@laratype/database";
//@ts-ignore
// import authenticate from "passport/lib/middleware/authenticate";
import { ServiceProvider, type LaratypeConfig as Config, ContextApi, type RedirectStatusCode, manifestEntry, loadDefault, loadEnv } from "@laratype/support";
import { randomUUID } from "crypto";
import { type NextHandler, redirect, type Request, type Response } from "@laratype/http";
import AuthManager from "../guard/AuthManager";
import PassportGuard from "../guard/PassportGuard";
import { AUTH_CONFIG } from "../guard/tokens";

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

  /** Binds `AUTH_CONFIG` and the `AuthManager` singleton from app/config/auth.ts (A4 #151). */
  public async register() {
    // app/config/auth.ts and the PersonalAccessToken model, from the app manifest (docs/v1/build.md › Plugin chain)
    const authEntry = manifestEntry('configs', 'auth');
    if(!authEntry) throw new Error("app/config/auth.ts not found: the app manifest has no auth config");

    // app/config/auth.ts may read Env.get(), and EnvLoadServiceProvider loads the env file only in boot(), after every register()
    loadEnv();
    // Every register() runs before any boot() (K1 #152's ConfigLoadServiceProvider included), so config('auth') is not
    // loaded yet: the config comes from the manifest, and K1 loads the same module later for config('auth').
    const authConfig = await loadDefault<Config.Auth>(authEntry);

    const personalModel = manifestEntry('models', 'PersonalAccessToken');
    const tokenModel = personalModel ? await loadDefault<typeof Model>(personalModel) : undefined;

    this.app.instance(AUTH_CONFIG, authConfig);
    this.app.singleton(AuthManager, (app) => new AuthManager(app.make(AUTH_CONFIG), tokenModel));
  }

  /** Registers the strategy of every passport guard under the guard's name. */
  public async boot() {
    const auth = this.app.make(AuthManager);

    for (const guardName in auth.config.guards) {
      const guard = auth.guard(guardName);
      if(guard instanceof PassportGuard) {
        guard.register(passport, storeManagement);
      }
    }

    passport.framework({
      initialize,
      authenticate,
    });
  }

}
