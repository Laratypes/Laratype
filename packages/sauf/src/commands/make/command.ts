import { CommandSignatureError, parseSignature } from "@laratype/console";
import MakeCommand from "../../utils/MakeCommand";

/**
 * `SendMail` -> `send:mail`, `TypesGenerate` -> `types:generate`: the v1 command names use `:`. An underscore or space
 * separates words too, and an empty segment adds nothing, so `_CleanCache`, `CleanCache_` and `Clean__Cache` all give
 * `clean:cache`: the generated signature never starts or ends with `:` and has no empty segment.
 */
export function commandSignature(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1:$2")
    .split(/[_\s]+/)
    .filter(Boolean)
    .join(":")
    .toLowerCase();
}

/**
 * Throws when registration (`parseSignature()`) would reject `signature` at the next CLI run, naming the command whose
 * name cannot give a valid one. `make()` checks every name before it writes the first stub
 * (docs/v1/cli.md › make:* generators › Diagnostics).
 */
export function assertCommandSignature(commandName: string, signature: string): void {
  try {
    parseSignature(signature);
  } catch (error) {
    if (!(error instanceof CommandSignatureError)) throw error;
    throw new Error(
      `make:command: ${JSON.stringify(commandName)} does not give a valid signature: ${error.message}`,
      { cause: error }
    );
  }
}

export default class MakeCommandCommand extends MakeCommand {

  static signature = "make:command";

  static description = "Create a new command files";

  static arguments = [
    {
      name: "<names...>",
      description: "The names of the command to create"
    }
  ]

  async make(commandNames: string[]) {
    const resourcePath = this.resolve("sauf", "Command.template");

    // Every signature is checked before the first stub is written: a bad name fails this run, not the next CLI start.
    const commands = commandNames.map(commandName => {
      const fileName = this.getFileName(commandName).replace(/\.ts$/, "");
      const signature = commandSignature(fileName);
      assertCommandSignature(fileName, signature);
      return { fileName, signature };
    });

    return commands.map(({ fileName, signature }) => {
      // The manifest reads the top level of the command folder only: a sub-path is flattened, not silently skipped
      const destinationPath = `./app/console/commands/${fileName}.ts`;
      const result = this.build(resourcePath, { CommandName: fileName, signature });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
