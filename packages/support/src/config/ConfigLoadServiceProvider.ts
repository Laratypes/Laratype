import { ENV_CONFIG_NAME, setConfigs } from "@laratype/core";
import type { LaratypeConfig as ConfigContract } from "../contracts/Config";
import { appManifest, loadDefault } from "../manifest/AppManifest";
import { ServiceProvider } from "../ServiceProvider";
import Config from "./Config";

export default class ConfigLoadServiceProvider extends ServiceProvider {
  public async boot() {
    // Every app/config/*.ts but providers.ts and the env file, by file name: what `config('<file>.<path>')` reads.
    // config() is sync, so they all load here; a config file can't call config() at load time. config.ts loads first
    // and fills 0.5's Config, so the modules the other files import can still call Config.get() at load time.
    const entries = appManifest().configs.filter((entry) => entry.name !== ENV_CONFIG_NAME);
    const main = entries.find((entry) => entry.name === "config");
    if (!main) throw new Error("app/config/config.ts not found: the app manifest has no config");
    const configs: Record<string, unknown> = Object.create(null);
    configs.config = await loadDefault(main);
    Config.setConfigs(configs.config as ConfigContract.AppConfig);
    for (const entry of entries) {
      if (entry !== main) configs[entry.name] = await loadDefault(entry);
    }
    setConfigs(Object.freeze(configs));
  }
}
