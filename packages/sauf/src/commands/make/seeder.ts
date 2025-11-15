import MakeCommand from "../../utils/MakeCommand";

export default class MakeSeederCommand extends MakeCommand {

  static signature = "make:seeder";

  static description = "Create a new seeder file";

  static arguments = [
    {
      name: "<model>",
      description: "The model to attach the seeder to"
    }
  ]

  async make(name: string) {
    const resourcePath = this.resolve("sauf", "Seeder.template");

    const commandName = this.getFileName(name) + "Seeder";

    const destinationPath = "./database/seeders/" + commandName + ".ts";
    const result = this.build(resourcePath, { ModelName: this.getFileName(name) });
    this.publish(result, destinationPath);
    return destinationPath;
  }
}
