import { Object } from "ts-toolbelt"
import { ConfigLoaderNotLoadYet } from "../exception/ConfigLoaderNotLoadYet";
import { Config as ConfigContract } from "laratype";

export default class Config {
  protected static config = null;

  public static get<T extends Object.Paths<ConfigContract.AppConfig>>(keys: T)
  {
    if(this.config === null) {
      throw new ConfigLoaderNotLoadYet();
    }

    let ctx = this.config;

    keys.forEach((key) => {
      ctx = ctx[key];
    });

    return ctx as Object.Path<ConfigContract.AppConfig, T>;
  }

  public static setConfigs(config: any) {
    this.config = config;
  }
}