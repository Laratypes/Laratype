import MakeCommand from "../../utils/MakeCommand";

/** `SendMail` -> `send:mail`, `TypesGenerate` -> `types:generate`: the v1 command names use `:`. */
export function commandSignature(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1:$2")
    .replace(/[_\s]+/g, ":")
    .toLowerCase();
}

export default class MakeCommandCommand extends MakeCommand {

  static signature = "make:command";

  static description = "Create a new command files";

  static arguments = [
    {
      name: "<names...>",
      description: "The names of the command to create"
    }
  ]

  async make(commandNames: string[]) {
    const resourcePath = this.resolve("sauf", "Command.template");

    return commandNames.map(commandName => {
      const destinationPath = "./app/console/commands/" + commandName + ".ts";
      const CommandName = this.getFileName(commandName).replace(/\.ts$/, "");
      const result = this.build(resourcePath, { CommandName, signature: commandSignature(CommandName) });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
