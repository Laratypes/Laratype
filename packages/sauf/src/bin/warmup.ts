import { Command as CommandInstance } from "@laratype/console";
import { program } from "commander"
import figlet from "figlet"
import { green } from "kolorist"
//@ts-ignore
import standard from "figlet/importable-fonts/Standard.js";
import frameworkCommands from "../commands";
import { importRootCommands, importRouteConsoleCommands } from "../utils";
import { createLogger } from "vite";
import Transpile from "../utils/transplie";
import { RollupPluginSwc } from "../utils/plugin";
import Command from "../utils/command";

if(globalThis.__PROD__ === undefined) {
  globalThis.__PROD__ = process.env.NODE_ENV === "production"
}

figlet.parseFont("Standard", standard);

console.log(green(figlet.textSync("Laratype")));

class CommandManager {
  protected commands: Array<Command> = [];

  public registerCommand(command: typeof CommandInstance, transpiler: Transpile) {
    const commandWrapper = new Command(command, transpiler);
    this.commands.push(commandWrapper);
  }

  public async register(transpiler: Transpile) {
    const projectCommands = await importRootCommands(transpiler);
    const routeCommands = await importRouteConsoleCommands(transpiler);
    frameworkCommands.forEach(command => this.registerCommand(command, transpiler));
    projectCommands.forEach(command => this.registerCommand(command, transpiler));
    routeCommands.forEach(command => this.registerCommand(command, transpiler));
  }

  public async boot() {
    globalThis.__sauf_start_time = performance.now();
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

    await transpiler.init();

    await this.register(transpiler);

    for (const instance of this.commands) {
      program.name("sauf")
      program.addCommand(instance.getCommander())
    }
    program.parse()
    
  }
}

new CommandManager().boot();
