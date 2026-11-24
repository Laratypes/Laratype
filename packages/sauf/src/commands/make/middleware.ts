import MakeCommand from "../../utils/MakeCommand";
import { GENERATOR_FOLDERS, generatorPath } from "./path";

export default class MakeMiddlewareCommand extends MakeCommand {

  static signature = "make:middleware";

  static description = "Create a new middleware files";

  static arguments = [
    {
      name: "<names...>",
      description: "The names of the middleware to create"
    }
  ]

  async make(middlewareNames: string[]) {
    const resourcePath = this.resolve("sauf", "Middleware.template");
    // A sub-path (`admin/Post`) is a folder: the exported name is the file name alone
    const names = middlewareNames.map(middlewareName =>
      generatorPath(middlewareName, "middleware", { identifier: true }),
    );

    return names.map(name => {
      const destinationPath = `./${GENERATOR_FOLDERS.middleware}/${name}.ts`;
      const result = this.build(resourcePath, { MiddlewareName: this.getFileName(name) });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
