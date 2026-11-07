import { existsSync } from "node:fs";
import MakeCommand from "../../utils/MakeCommand";

/** `SendMail` -> `send:mail`, `TypesGenerate` -> `types:generate`: the v1 command names use `:`. */
export function commandSignature(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1:$2")
    .replace(/[_\s]+/g, ":")
    .toLowerCase();
}

/** The folders the manifest reads commands from, in its order (docs/v1/build.md › Plugin chain). */
const COMMAND_LAYOUTS = ["app/src/console/commands", "app/console/commands"] as const;
const COMMAND_EXTENSIONS = [".ts", ".mts"] as const;

/**
 * The file that already declares a command of this name, if any. The manifest reads both layouts and both extensions,
 * so writing a second file with the same name is a scan error (docs/v1/cli.md › make:* generators › Diagnostics).
 */
function existingCommandFile(fileName: string): string | undefined {
  for (const dir of COMMAND_LAYOUTS) {
    for (const extension of COMMAND_EXTENSIONS) {
      const path = `${dir}/${fileName}${extension}`;
      if (existsSync(path)) return path;
    }
  }
  return undefined;
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

    return commandNames.map(commandName => {
      const fileName = this.getFileName(commandName).replace(/\.ts$/, "");
      // The manifest reads the top level of the command folder only: a sub-path is flattened, not silently skipped
      const destinationPath = `./app/console/commands/${fileName}.ts`;
      const signature = commandSignature(fileName);
      const existing = existingCommandFile(fileName);
      // An existing file at the destination is the usual skip; a second file of the same name would fail the manifest
      if (existing !== undefined && existing !== destinationPath.slice(2)) {
        throw new Error(
          `Cannot create ${destinationPath.slice(2)}: ${existing} already declares the command ${JSON.stringify(signature)}, ` +
            "and the manifest reads both. Fix: rename or remove one.",
        );
      }
      const result = this.build(resourcePath, { CommandName: fileName, signature });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
