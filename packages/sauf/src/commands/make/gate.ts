import MakeCommand from "../../utils/MakeCommand";
import { GENERATOR_FOLDERS, generatorPath } from "./path";

export default class MakeGateCommand extends MakeCommand {

  static signature = "make:gate";

  static description = "Create a new gate files";

  static arguments = [
    {
      name: "<names...>",
      description: "The names of the gate to create"
    }
  ]

  async make(gateNames: string[]) {
    const resourcePath = this.resolve("sauf", "Gate.template");
    // A sub-path (`admin/Post`) is a folder: the exported name is the file name alone
    const names = gateNames.map(gateName => generatorPath(gateName, "gate", { identifier: true }));

    return names.map(name => {
      const destinationPath = `./${GENERATOR_FOLDERS.gate}/${name}.ts`;
      const result = this.build(resourcePath, { GateName: this.getFileName(name) });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
