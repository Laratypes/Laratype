import type { Command } from "@laratype/console";
import { program } from "commander"
import figlet from "figlet"
import { green } from "kolorist"
//@ts-ignore
import standard from "figlet/importable-fonts/Standard.js";
import frameworkCommands from "../commands";
import { importRootCommands } from "../utils";

if(globalThis.__PROD__ === undefined) {
  globalThis.__PROD__ = process.env.NODE_ENV === "production"
}

figlet.parseFont("Standard", standard);

console.log(green(figlet.textSync("Laratype")));

class CommandManager {
  protected commands: Array<typeof Command> = [];

  public registerCommand(command: typeof Command) {
    this.commands.push(command);
  }

  public async register() {
    const projectCommands = await importRootCommands();
    frameworkCommands.forEach(command => this.registerCommand(command));
    projectCommands.forEach(command => this.registerCommand(command));
  }

  public async boot() {
    await this.register();

    for (const command of this.commands) {
      const instance = new command()
      program.name("sauf")
      program.addCommand(instance.getCommander())
    }
    program.parse()
    
  }
}

new CommandManager().boot();
