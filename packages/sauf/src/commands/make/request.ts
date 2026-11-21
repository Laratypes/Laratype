import MakeCommand from "../../utils/MakeCommand";
import { GENERATOR_FOLDERS, generatorPath } from "./path";

export default class MakeRequestCommand extends MakeCommand {

  static signature = "make:request";

  static description = "Create a new request files";

  static arguments = [
    {
      name: "<names...>",
      description: "The names of the request to create"
    }
  ]

  async make(requestNames: string[]) {
    const resourcePath = this.resolve("sauf", "Request.template");
    // A sub-path (`admin/Post`) is a folder: the exported name is the file name alone
    const names = requestNames.map(requestName =>
      generatorPath(requestName, "request", { identifier: true }),
    );

    return names.map(name => {
      const destinationPath = `./${GENERATOR_FOLDERS.request}/${name}.ts`;
      const result = this.build(resourcePath, { RequestName: this.getFileName(name) });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
