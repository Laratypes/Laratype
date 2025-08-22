import { Command } from "@laratype/console";
import { program } from "commander"
import figlet from "figlet"
//@ts-ignore
import standard from "figlet/importable-fonts/Standard.js";
import commands from "../commands";

figlet.parseFont("Standard", standard);

console.log(figlet.textSync("Laratype"));

class CommandManager {
  protected commands: Array<typeof Command> = [];

  public registerCommand(command: typeof Command) {
    this.commands.push(command);
  }

  public register() {
    commands.forEach(command => this.registerCommand(command));
  }

  public boot() {
    this.register();

    for (const command of this.commands) {
      const instance = new command()
      program.addCommand(instance.getCommander())
    }
    program.parse()
    
  }
}

new CommandManager().boot();
