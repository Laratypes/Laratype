#!/usr/bin/env -S npx tsx

import { Command } from "@laratype/console";
import LaratypeStartupCommand from "./LaratypeStartup";
import { program } from "commander"
import figlet from "figlet"

console.log(figlet.textSync("Laratype"));

class CommandManager {
  protected commands: Array<typeof Command> = [];

  public registerCommand(command: typeof Command) {
    this.commands.push(command);
  }

  public register() {
    this.registerCommand(LaratypeStartupCommand);
  }

  public boot() {
    this.register();

    for (const command of this.commands) {
      program
        .command(command.signature)
        .description(command.description)
        .action(() => {
          return new command().handle()
        });;
    }
    program.parse()
    
  }
}

new CommandManager().boot();
