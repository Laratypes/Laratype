import MakeCommand from "../../utils/MakeCommand";
import { GENERATOR_FOLDERS, generatorPath } from "./path";

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
    // A sub-path (`admin/Post`) is a folder: the exported name is the file name alone
    const names = controllerNames.map(controllerName => generatorPath(controllerName, "controller"));

    return names.map(name => {
      const destinationPath = `./${GENERATOR_FOLDERS.controller}/${name}.ts`;
      const result = this.build(resourcePath, { ControllerName: this.getFileName(name) });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
