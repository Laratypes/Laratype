import MakeCommand from "../../utils/MakeCommand";
import { GENERATOR_FOLDERS, generatorPath } from "./path";

/**
 * `UpdateUserGate` -> `update-user` and `Update_UserGate` -> `update-user`: the gate's name in the stub, kebab-case and
 * without the class suffix.
 */
const gateName = (file: string): string => {
  const name = file
    .replace(/Gate$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
  // A file called `Gate` keeps its name rather than writing `Gate.define("", ...)`
  return name || file.toLowerCase();
};

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
    // A sub-path (`admin/Post`) is a folder: the name is the file name alone
    const names = gateNames.map(name => generatorPath(name, "gate", { identifier: true }));

    return names.map(name => {
      const destinationPath = `./${GENERATOR_FOLDERS.gate}/${name}.ts`;
      // The kebab name is the gate's diagnostic name and never a lookup key; the usage comment imports the default
      // value as a fixed local name, so a file called `Gate.ts` does not shadow the framework class
      const result = this.build(resourcePath, {
        GateName: gateName(this.getFileName(name)),
        GateImportPath: `../gates/${name}`,
      });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
