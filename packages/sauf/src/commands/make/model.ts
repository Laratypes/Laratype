import MakeCommand from "../../utils/MakeCommand";
import { GENERATOR_FOLDERS, generatorPath } from "./path";

export default class MakeModelCommand extends MakeCommand {

  static signature = "make:model";

  static description = "Create a new model files";

  static arguments = [
    {
      name: "<names...>",
      description: "The names of the model to create"
    }
  ]

  async make(modelNames: string[]) {
    const resourcePath = this.resolve("sauf", "Model.template");
    // A sub-path (`admin/Post`) is a folder: the exported name is the file name alone
    const names = modelNames.map(modelName => generatorPath(modelName, "model", { identifier: true }));

    return names.map(name => {
      const destinationPath = `./${GENERATOR_FOLDERS.model}/${name}.ts`;
      const result = this.build(resourcePath, { ModelName: this.getFileName(name) });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
