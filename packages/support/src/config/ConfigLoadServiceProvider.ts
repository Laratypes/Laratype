import type { LaratypeConfig as ConfigContract } from "../contracts/Config";
import { loadDefault, manifestEntry } from "../manifest/AppManifest";
import { ServiceProvider } from "../ServiceProvider";
import Config from "./Config";

export default class ConfigLoadServiceProvider extends ServiceProvider {
  public async boot() {
    const entry = manifestEntry('configs', 'config');
    if (!entry) throw new Error("app/config/config.ts not found: the app manifest has no config");
    const config = await loadDefault<ConfigContract.AppConfig>(entry);
    Config.setConfigs(config)
  }
}