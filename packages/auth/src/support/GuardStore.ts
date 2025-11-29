import { type Model } from "@laratype/database";
import { LaratypeConfig as Config } from "@laratype/support";

export class GuardStore {

  public static getAuthConfig() {
    return globalThis.__laratype_auth_config as Config.Auth;
  }

  public static getGuards() {
    const auth = this.getAuthConfig();

    return auth.guards;
  }

  public static setAuthConfig(authConfig: Config.Auth) {
    globalThis.__laratype_auth_config = authConfig;
  }

  public static getModelVerify() {
    return globalThis.__laratype_auth_model_verify as typeof Model;
  }

  public static setModelVerify(model: typeof Model) {
    globalThis.__laratype_auth_model_verify = model;
  }
  
}