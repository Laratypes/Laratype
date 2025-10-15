import { Command } from "@laratype/console";
import { importModule, ServiceProvider } from "@laratype/support";
import { createLogger, createServer, InlineConfig, mergeConfig, type ViteDevServer } from "vite";
import { RollupPluginSwc } from "./plugin";

const logger = createLogger()
const loggerWarn = logger.warn

logger.warn = (msg, options) => {
  if (msg.includes('vite:import-analysis') && msg.includes(' /* @vite-ignore */')) return
  loggerWarn(msg, options)
}

export class ServiceProviderBootstrapCommand extends Command {

  protected viteConfig: InlineConfig = {
    // appType: 'custom',
    customLogger: logger,
    optimizeDeps: {
      noDiscovery: true,
      // Vite does not work well with optional dependencies,
      // mark them as ignored for now
      exclude: [
        '@swc/core',
      ],
    },
    esbuild: false,
    plugins: [
      RollupPluginSwc({
        module: {
          type: 'es6',
        },
        jsc: {
          target: 'es2022',
          parser: {
            syntax: 'typescript',
            decorators: true,
            tsx: false,
          },
          transform: {
            legacyDecorator: true,
            decoratorMetadata: true,
          },
        },
      })
    ]
  }

  protected async bootstrapServiceProvider(vite: ViteDevServer, providers: Array<typeof ServiceProvider>) {
    const { register } = await importModule("laratype") as typeof import("laratype");

    const configServiceProviders = await register(true);
    const serviceProviders = [...configServiceProviders, ...providers];

    for(let Provider of serviceProviders) {
      const handler = new Provider(vite).boot()
      if(handler instanceof Promise) {
        await handler;
      }
    }

  }

  protected setViteConfig(config: InlineConfig) {
    this.viteConfig = mergeConfig(this.viteConfig, config);
  }

  protected getViteConfig() {
    return this.viteConfig;
  }

  protected async initViteDevServer(): Promise<ViteDevServer> {
    return await createServer(this.getViteConfig());
  }

}