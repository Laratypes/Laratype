import { ENV_CONFIG_NAME, setConfigs } from "@laratype/core";
import type { LaratypeConfig as ConfigContract } from "../contracts/Config";
import { appManifest, loadDefault } from "../manifest/AppManifest";
import { ServiceProvider } from "../ServiceProvider";
import Config from "./Config";

export default class ConfigLoadServiceProvider extends ServiceProvider {
  public async boot() {
    // Every app/config/*.ts but providers.ts and the env file, by file name: what `config('<file>.<path>')` reads.
    // config() is sync, so they all load here, one after the other; a config file can't call config() at load time.
    const entries = appManifest().configs.filter((entry) => entry.name !== ENV_CONFIG_NAME);
    const configs: Record<string, unknown> = Object.create(null);
    for (const entry of entries) {
      configs[entry.name] = await loadDefault(entry);
    }
    if (!("config" in configs)) throw new Error("app/config/config.ts not found: the app manifest has no config");
    setConfigs(Object.freeze(configs));
    Config.setConfigs(configs.config as ConfigContract.AppConfig)
  }
}
