import MakeCommand from "../../utils/MakeCommand";

export default class MakeFactoryCommand extends MakeCommand {

  static signature = "make:factory";

  static description = "Create a new factory file";

  static arguments = [
    {
      name: "<model>",
      description: "The model to attach the factory to"
    }
  ]

  async make(name: string) {
    const resourcePath = this.resolve("sauf", "Factory.template");

    const commandName = this.getFileName(name) + "Factory";

    const destinationPath = "./database/factories/" + commandName + ".ts";
    const result = this.build(resourcePath, { ModelName: this.getFileName(name) });
    this.publish(result, destinationPath);
    return destinationPath;
  }
}
