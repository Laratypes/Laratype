import { program } from "commander";
import { type Command as CommandInstance } from "@laratype/console";
import type { AppManifest } from "@laratype/support";
import Transpile from "./utils/transplie";
import { importRootCommands, importRouteConsoleCommands } from "./utils";
import { useAppManifest } from "./manifest/load";
import Command from "./utils/command";
import { InitDatabaseCommand, SeedDatabaseCommand } from "./commands/db";
import { RouteListCommand } from "./commands/route";
import "./utils/banner"

globalThis.__PROD__ = true;
globalThis.__APP_PROD__ = true;

class AppCommandManager {
  protected commands: Array<Command> = [];

  public registerCommand(command: typeof CommandInstance, transpiler: Transpile) {
    const commandWrapper = new Command(command, transpiler);
    this.commands.push(commandWrapper);
  }
  
  public async register(transpiler: Transpile, manifest: AppManifest) {
    const frameworkCommands = [
      InitDatabaseCommand,
      SeedDatabaseCommand,
      RouteListCommand
    ];
    const projectCommands = await importRootCommands(manifest);
    const routeCommands = await importRouteConsoleCommands(manifest);
    frameworkCommands.forEach(command => this.registerCommand(command, transpiler));
    projectCommands.forEach(command => this.registerCommand(command, transpiler));
    routeCommands.forEach(command => this.registerCommand(command, transpiler));
  }
  
  public async boot(): Promise<void> {
    globalThis.__sauf_start_time = performance.now();

    const transpiler = new Transpile({})

    // dist/app.manifest.js, written by `sauf build` next to this file
    const manifest = await useAppManifest();

    await this.register(transpiler, manifest);

    for (const instance of this.commands) {
      program.name("sauf")
      program.addCommand(instance.getCommander())
    }
    program.parse()
  }
}

new AppCommandManager().boot();
