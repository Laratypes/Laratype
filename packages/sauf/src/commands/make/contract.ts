import MakeCommand from "../../utils/MakeCommand";
import { GENERATOR_FOLDERS, generatorPath } from "./path";

/** A root `index` has no contract name: the scan fails it (docs/v1/contract.md › Contract folder tree). */
const ROOT_INDEX = /^index$/i;

export default class MakeContractCommand extends MakeCommand {

  static signature = "make:contract {names*}";

  static description = "Create a new contract file";

  async make(contractNames: string[]) {
    const resourcePath = this.resolve("sauf", "Contract.template");
    // The contract folder tree is the source of its URL prefix and name (docs/v1/contract.md › Contract folder tree),
    // so a sub-path is kept: `users/posts` writes app/api/users/posts.ts
    const names = contractNames.map(contractName => {
      const name = generatorPath(contractName, "contract", { params: true, backslashes: true });
      if (!name.includes("/") && ROOT_INDEX.test(name)) {
        throw new Error(
          `Invalid contract name ${JSON.stringify(name)}: a root index has no contract name ` +
          `under ${GENERATOR_FOLDERS.contract}. Fix: name the file after its contract (users.ts), ` +
          `or use a folder index (users/index.ts).`,
        );
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
