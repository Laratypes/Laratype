import { Config as ConfigContract } from "laratype";
import { getDefaultExports, getProjectPath } from "../path-resolver/pathResolver";
import { ServiceProvider } from "../ServiceProvider";
import Config from "./Config";

export default class ConfigLoadServiceProvider extends ServiceProvider {
  public async boot() {
    const module = await import(getProjectPath('/config/config.ts'));
    const config = getDefaultExports(module) as ConfigContract.AppConfig;
    Config.setConfigs(config)
  }
}