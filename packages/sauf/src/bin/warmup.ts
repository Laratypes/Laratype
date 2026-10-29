import type { ConsoleCommand } from "@laratype/console";
import { program } from "commander"
import { resolveModule, type AppManifest } from "@laratype/support";
import { resolve } from "node:path";
import { importRootCommands, importRouteConsoleCommands, type EntryLoader } from "../utils";
import { slash } from "../typegen/sync";
import Transpile from "../utils/transplie";
import { RollupPluginSwc } from "../utils/plugin";
import { laratypeDi } from "../di/plugin";
import { laratypeApi } from "../typegen/plugin";
import { laratypeManifest, useAppManifest } from "../manifest";
import Command from "../utils/command";
import "../utils/banner"

if(globalThis.__PROD__ === undefined) {
  globalThis.__PROD__ = process.env.NODE_ENV === "production"
}


export class CommandManager {
  protected commands: Array<Command> = [];

  public registerCommand(command: ConsoleCommand, transpiler: Transpile) {
    const commandWrapper = new Command(command, transpiler);
    this.commands.push(commandWrapper);
  }

  public async register(transpiler: Transpile, manifest: AppManifest, load?: EntryLoader) {
    const { default: frameworkCommands } = await import("../commands");
    const projectCommands = await importRootCommands(manifest, load);
    const routeCommands = await importRouteConsoleCommands(manifest, load);
    frameworkCommands.forEach(command => this.registerCommand(command, transpiler));
    projectCommands.forEach(command => this.registerCommand(command, transpiler));
    routeCommands.forEach(command => this.registerCommand(command, transpiler));
  }

  public async boot() {
    globalThis.__sauf_start_time = performance.now();
    const { createLogger } = await import(resolveModule("vite", {
      url: import.meta.url,
    })) as typeof import("vite");
    const logger = createLogger()
    const loggerWarn = logger.warn

    logger.warn = (msg, options) => {
      if (msg.includes('vite:import-analysis') && msg.includes(' /* @vite-ignore */')) return
      loggerWarn(msg, options)
    }

    const transpiler = new Transpile({
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
        // `virtual:laratype/app`: the app's providers, configs, routes, commands, models... found at load time
        laratypeManifest(),
        // Before SWC: the DI transform reads the TypeScript param types SWC erases.
        laratypeDi(),
        // `$api`: the generated contract tree, scanned the first time the app imports it.
        laratypeApi(),
        RollupPluginSwc({
          sourceMaps: true,
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
    });

    const runner = await transpiler.init();

    await runner.ready();

    globalThis.__sauf_transpiler_instance = runner.ssrLoadModule.bind(runner);

    // A scan error is printed here and thrown only where the app is needed (appManifest())
    const manifest = await useAppManifest((id) => runner.ssrLoadModule(id));

    // The manifest's own module ids, with Vite's source-mapped stack traces for errors in the app's commands
    await this.register(transpiler, manifest, (entry) => runner.ssrLoadModule(slash(resolve(entry.path)), { fixStacktrace: true }));

    for (const instance of this.commands) {
      program.name("sauf")
      program.addCommand(instance.getCommander())
    }
    program.parse()
    
  }
}
