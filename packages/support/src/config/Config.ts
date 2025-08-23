import { Object } from "ts-toolbelt"
import { ConfigLoaderNotLoadYet } from "../exception/ConfigLoaderNotLoadYet";
import { LaratypeConfig as ConfigContract } from "../contracts/Config";

export default class Config {

  public static get<T extends Object.Paths<ConfigContract.AppConfig>>(keys: T)
  {
    const config = (globalThis as any).__laratype_config
    if(!config) {
      throw new ConfigLoaderNotLoadYet();
    }

    let ctx = config;

    for (const key of keys) {
      ctx = ctx[key];
      if(ctx === undefined) {
        return ctx;
      }
    }

    return ctx as Object.Path<ConfigContract.AppConfig, T>;
  }

  public static setConfigs(config: any) {
    (globalThis as any).__laratype_config = config;
  }
}