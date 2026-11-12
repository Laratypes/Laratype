import { existsSync } from "node:fs";
import { CommandSignatureError, parseSignature } from "@laratype/console";
import { KIND_EXTENSIONS, MANIFEST_DIRS } from "../../manifest/scan";
import MakeCommand from "../../utils/MakeCommand";
import { GENERATOR_FOLDERS, generatorPath } from "./path";

/**
 * `SendMail` -> `send:mail`, `TypesGenerate` -> `types:generate`: the v1 command names use `:`. A colon, underscore or
 * space separates words too, and an empty segment adds nothing, so `_CleanCache`, `CleanCache_` and `Clean__Cache` all
 * give `clean:cache`: the generated signature never starts or ends with `:` and has no empty segment.
 */
export function commandSignature(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1:$2")
    .split(/[:_\s]+/)
    .filter(Boolean)
    .join(":")
    .toLowerCase();
}

/**
 * The command files of this name in every folder and extension the manifest reads. One name twice is a scan error
 * (docs/v1/build.md › Plugin chain), so `make:command` must not add a second file.
 */
function commandFiles(fileName: string): string[] {
  return MANIFEST_DIRS.commands.flatMap((dir) =>
    KIND_EXTENSIONS.commands
      .map((extension) => `${dir}/${fileName}${extension}`)
      .filter((path) => existsSync(path)),
  );
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

    // Every name, signature and destination is checked before the first stub is written: a bad name or a name
    // another command file already uses fails this run, not the next CLI start, and a retry writes every stub.
    const commands = commandNames.map(commandName => {
      // The manifest reads the top level of the command folder only: a sub-path is flattened, not silently skipped
      const fileName = generatorPath(this.getFileName(commandName).replace(/\.ts$/, ""), "command", {
        identifier: true,
      });
      const signature = commandSignature(fileName);
      assertCommandSignature(fileName, signature);
      const destinationPath = `./${GENERATOR_FOLDERS.command}/${fileName}.ts`;
      const target = destinationPath.slice(2);
      // An existing file at the destination is the usual skip; a second file of the same name would fail the manifest
      const existing = commandFiles(fileName).find((path) => path !== target);
      if (existing !== undefined) {
        const reason = `Cannot create ${target}: ${existing} already uses the command name ${JSON.stringify(fileName)}`;
        throw new Error(`${reason}, and the manifest reads both. Fix: rename or remove one.`);
      }
      return { fileName, signature, destinationPath };
    });

    return commands.map(({ fileName, signature, destinationPath }) => {
      const result = this.build(resourcePath, { CommandName: fileName, signature });
      this.publish(result, destinationPath);
      return destinationPath;
    });
  }
}
