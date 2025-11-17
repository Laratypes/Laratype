import { LaratypeConfig as ConfigContract } from "../contracts/Config";
import { getDefaultExports, getAppPath, importModule } from "../path-resolver/pathResolver";
import { ServiceProvider } from "../ServiceProvider";
import Config from "./Config";

export default class ConfigLoadServiceProvider extends ServiceProvider {
  public async boot() {
    const module = await importModule(getAppPath('/config/config.ts'));
    const config = getDefaultExports(module) as ConfigContract.AppConfig;
    Config.setConfigs(config)
  }
}