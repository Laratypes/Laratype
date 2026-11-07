import MakeCommand from "../../utils/MakeCommand";

/** One folder or file of the contract tree: a name, or a `[param]` folder (docs/v1/contract.md › Contract folder tree). */
const CONTRACT_SEGMENT = /^(?:[A-Za-z0-9_-]+|\[[A-Za-z_][A-Za-z0-9_]*\])$/;

/** The path under app/api for a command argument, or an error when a segment would leave the tree. */
function contractPath(contractName: string): string {
  const name = contractName.replace(/\\/g, "/").replace(/\.ts$/, "");
  const segments = name.split("/");
  // `[param]` is a folder only; the last segment is the contract file
  const valid = segments.every((segment, index) =>
    index === segments.length - 1 ? /^[A-Za-z0-9_-]+$/.test(segment) : CONTRACT_SEGMENT.test(segment),
  );
  if (!name.startsWith("/") && valid) return name;
  const reason = `Invalid contract name ${JSON.stringify(contractName)}`;
  throw new Error(`${reason}: use letters, digits, "_" and "-", or a [param] folder, under app/api.`);
}

export default class MakeContractCommand extends MakeCommand {

  static signature = "make:contract {names*}";

  static description = "Create a new contract file";

  async make(contractNames: string[]) {
    const resourcePath = this.resolve("sauf", "Contract.template");

    return contractNames.map(contractName => {
      // The contract folder tree is the source of its URL prefix and name (docs/v1/contract.md › Contract folder tree),
      // so a sub-path is kept: `users/posts` writes app/api/users/posts.ts
      const destinationPath = `./app/api/${contractPath(contractName)}.ts`;
      const result = this.build(resourcePath, {});
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
