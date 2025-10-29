import MakeCommand from "../../utils/MakeCommand";

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
      const destinationPath = "./src/console/commands/" + commandName + ".ts";
      const result = this.build(resourcePath, { CommandName: this.getFileName(commandName) });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
