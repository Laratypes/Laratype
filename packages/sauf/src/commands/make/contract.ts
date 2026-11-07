import MakeCommand from "../../utils/MakeCommand";
import { GENERATOR_FOLDERS, generatorPath } from "./path";

export default class MakeContractCommand extends MakeCommand {

  static signature = "make:contract {names*}";

  static description = "Create a new contract file";

  async make(contractNames: string[]) {
    const resourcePath = this.resolve("sauf", "Contract.template");
    // The contract folder tree is the source of its URL prefix and name (docs/v1/contract.md › Contract folder tree),
    // so a sub-path is kept: `users/posts` writes app/api/users/posts.ts
    const names = contractNames.map(contractName =>
      generatorPath(contractName, "contract", { params: true, backslashes: true }),
    );

    return names.map(name => {
      const destinationPath = `./${GENERATOR_FOLDERS.contract}/${name}.ts`;
      const result = this.build(resourcePath, {});
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
