import { program } from "commander";
import type { ConsoleCommand } from "@laratype/console";
import type { AppManifest } from "@laratype/support";
import Transpile from "./utils/transplie";
import { importRootCommands, importRouteConsoleCommands } from "./utils";
import { useAppManifest } from "./manifest/load";
import Command, { assertCommandNameFree } from "./utils/command";
import { InitDatabaseCommand, SeedDatabaseCommand } from "./commands/db";
import { RouteListCommand } from "./commands/route";
import "./utils/banner"

globalThis.__PROD__ = true;
globalThis.__APP_PROD__ = true;

class AppCommandManager {
  protected commands: Array<Command> = [];

  /** The source per command name: the duplicate check names both sources in its error. */
  protected registered = new Map<string, string>();

  public registerCommand(command: ConsoleCommand, transpiler: Transpile, source: string) {
    const commandWrapper = new Command(command, transpiler);
    const name = commandWrapper.getCommander().name();
    assertCommandNameFree(name, this.registered, source);
    this.registered.set(name, source);
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
    frameworkCommands.forEach(command => this.registerCommand(command, transpiler, "a framework command"));
    projectCommands.forEach(command => this.registerCommand(command, transpiler, "a command file"));
    routeCommands.forEach(command => this.registerCommand(command, transpiler, "app/routes/console.ts"));
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
