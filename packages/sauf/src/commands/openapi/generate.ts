import process, { cwd } from "node:process";
import { Command, Console } from "@laratype/console";
import { green } from "kolorist";
import { errorReason, generateOpenApiFile } from "../../openapi";
import type { GeneratedOpenApiFile } from "../../openapi";
import { ScanError } from "../../typegen";

const PREFIX = "[sauf openapi:generate] ";

const SIGNATURE = "openapi:generate {--root=} {--base=} {--gen=.laratype} {--out=openapi.json}" as const;

/**
 * `sauf openapi:generate`: scans the contract tree, imports the generated `appApi` and the project's own
 * `@laratype/contract`, and writes the document. No app boot: `bootsApp = false` and no providers, like
 * `types:generate` (docs/v1/typegen.md › OpenAPI).
 */
export default class OpenApiGenerateCommand extends Command<typeof SIGNATURE> {
  static readonly signature = SIGNATURE;

  static description = "Generate an OpenAPI 3.1 document from the contract tree";

  // The generator reads files and imports the tree only: no register(), so no $api dev scan, and no provider boot
  static bootsApp = false;

  public async providers() {
    return [];
  }

  public async handle() {
    Console.start("Generating the OpenAPI document from the contract tree...");
    const startTime = performance.now();
    let result: GeneratedOpenApiFile;
    try {
      result = await generateOpenApiFile({
        projectDir: cwd(),
        root: this.option("root"),
        base: this.option("base"),
        gen: this.option("gen"),
        out: this.option("out"),
      });
    } catch (error) {
      // A ScanError has no prefix of its own; every message is printed once with this command's prefix (an
      // OpenApiGenerationError already carries it, and a contract error keeps its own after it).
      const message = error instanceof ScanError ? error.message : errorReason(error);
      Console.error(message.startsWith(PREFIX) ? message : `${PREFIX}${message}`);
      process.exitCode = 1;
      return 1;
    }

    for (const warning of result.warnings) Console.warn(`${PREFIX}${warning}`);

    const paths = Object.keys(result.document.paths).length;
    const outcome = result.changed ? `Wrote ${result.file}` : `${result.file} is unchanged`;
    Console.success(green(`${outcome} (${paths} paths) in ${(performance.now() - startTime).toFixed(2)}ms`));
    return 0;
  }
}
