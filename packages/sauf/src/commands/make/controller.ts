import MakeCommand from "../../utils/MakeCommand";

export default class MakeControllerCommand extends MakeCommand {

  static signature = "make:controller";

  static description = "Create a new controller files";

  static arguments = [
    {
      name: "<names...>",
      description: "The names of the controller to create"
    }
  ]

  async make(controllerNames: string[]) {
    const resourcePath = this.resolve("sauf", "Controller.template");

    return controllerNames.map(controllerName => {
      const destinationPath = "./src/http/controllers/" + controllerName + ".ts";
      const result = this.build(resourcePath, { ControllerName: this.getFileName(controllerName) });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
