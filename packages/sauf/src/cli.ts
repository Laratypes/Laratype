import { program } from "commander";
import { type Command as CommandInstance } from "@laratype/console";
import Transpile from "./utils/transplie";
import { importRootCommands, importRouteConsoleCommands } from "./utils";
import Command from "./utils/command";
import { InitDatabaseCommand, SeedDatabaseCommand } from "./commands/db";
import { RouteListCommand } from "./commands/route";
import "./utils/banner"

globalThis.__APP_PROD__ = true;

class AppCommandManager {
  protected commands: Array<Command> = [];

  public registerCommand(command: typeof CommandInstance, transpiler: Transpile) {
    const commandWrapper = new Command(command, transpiler);
    this.commands.push(commandWrapper);
  }
  
  public async register(transpiler: Transpile) {
    const frameworkCommands = [
      InitDatabaseCommand,
      SeedDatabaseCommand,
      RouteListCommand
    ];
    const projectCommands = await importRootCommands(transpiler);
    const routeCommands = await importRouteConsoleCommands(transpiler);
    frameworkCommands.forEach(command => this.registerCommand(command, transpiler));
    projectCommands.forEach(command => this.registerCommand(command, transpiler));
    routeCommands.forEach(command => this.registerCommand(command, transpiler));
  }
  
  public async boot(): Promise<void> {
    globalThis.__sauf_start_time = performance.now();

    const transpiler = new Transpile({})

    await this.register(transpiler);

    for (const instance of this.commands) {
      program.name("sauf")
      program.addCommand(instance.getCommander())
    }
    program.parse()
  }
}

new AppCommandManager().boot();
