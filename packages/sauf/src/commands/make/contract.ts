import MakeCommand from "../../utils/MakeCommand";

export default class MakeContractCommand extends MakeCommand {

  static signature = "make:contract {names*}";

  static description = "Create a new contract file";

  async make(contractNames: string[]) {
    const resourcePath = this.resolve("sauf", "Contract.template");

    return contractNames.map(contractName => {
      // The contract folder tree is the source of its URL prefix and name (docs/v1/contract.md › Contract folder tree),
      // so a sub-path is kept: `users/posts` writes app/api/users/posts.ts
      const name = contractName.replace(/\\/g, "/").replace(/\.ts$/, "");
      const destinationPath = `./app/api/${name}.ts`;
      const result = this.build(resourcePath, {});
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
