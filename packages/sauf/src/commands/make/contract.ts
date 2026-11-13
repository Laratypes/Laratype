import MakeCommand from "../../utils/MakeCommand";
import { GENERATOR_FOLDERS, generatorPath } from "./path";

/** An index needs a named folder: the scan fails a root index and one under `[param]` folders only. */
const INDEX_FILE = /^index$/i;

export default class MakeContractCommand extends MakeCommand {

  static signature = "make:contract {names*}";

  static description = "Create a new contract file";

  async make(contractNames: string[]) {
    const resourcePath = this.resolve("sauf", "Contract.template");
    // The contract folder tree is the source of its URL prefix and name (docs/v1/contract.md › Contract folder tree),
    // so a sub-path is kept: `users/posts` writes app/api/users/posts.ts
    const names = contractNames.map(contractName => {
      const name = generatorPath(contractName, "contract", { params: true, backslashes: true });
      const segments = name.split("/");
      const file = segments[segments.length - 1] ?? "";
      // A `[param]` folder names nothing, so an index under only param folders has no contract name either
      const namedFolder = segments.slice(0, -1).some(segment => !segment.startsWith("["));
      if (INDEX_FILE.test(file) && !namedFolder) {
        throw new Error([
          `Invalid contract name ${JSON.stringify(name)}: an index needs a named folder`,
          `under ${GENERATOR_FOLDERS.contract}.`,
          "Fix: name the file after its contract (users.ts), or use a named folder (users/index.ts).",
        ].join(" "));
      }
      return name;
    });

    return names.map(name => {
      const destinationPath = `./${GENERATOR_FOLDERS.contract}/${name}.ts`;
      const result = this.build(resourcePath, {});
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
