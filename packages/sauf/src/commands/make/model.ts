import MakeCommand from "../../utils/MakeCommand";

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
    
    return modelNames.map(modelName => {
      const destinationPath = "./src/models/" + modelName + ".ts";
      const result = this.build(resourcePath, { ModelName: this.getFileName(modelName) });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
