import { type Command as CommandInstance } from "@laratype/console";
import { program } from "commander"
import { resolveModule } from "@laratype/support";
import { importRootCommands, importRouteConsoleCommands } from "../utils";
import Transpile from "../utils/transplie";
import { RollupPluginSwc } from "../utils/plugin";
import Command from "../utils/command";
import "../utils/banner"

if(globalThis.__PROD__ === undefined) {
  globalThis.__PROD__ = process.env.NODE_ENV === "production"
}


export class CommandManager {
  protected commands: Array<Command> = [];

  public registerCommand(command: typeof CommandInstance, transpiler: Transpile) {
    const commandWrapper = new Command(command, transpiler);
    this.commands.push(commandWrapper);
  }

  public async register(transpiler: Transpile) {
    const { default: frameworkCommands } = await import("../commands");
    const projectCommands = await importRootCommands(transpiler);
    const routeCommands = await importRouteConsoleCommands(transpiler);
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

    await this.register(transpiler);

    for (const instance of this.commands) {
      program.name("sauf")
      program.addCommand(instance.getCommander())
    }
    program.parse()
    
  }
}
