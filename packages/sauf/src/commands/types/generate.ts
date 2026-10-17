import process, { cwd } from "node:process";
import { Command, Console } from "@laratype/console";
import { green } from "kolorist";
import { ScanError, generateTypes, readApiTreeConfig, resolveApiTree } from "../../typegen";

export default class TypesGenerateCommand extends Command {

  static signature = 'types:generate'

  static description = 'Generate $types.d.ts, .laratype/api/index.gen.ts and the separate-repo api.ts from the contract tree'

  static options = [
    ['--root <dir>', 'Contract tree root, relative to the project (default: config api.root, else app/api)'],
    ['--base <path>', 'URL base of the root (default: config api.base, else /api)'],
    ['--out <dir>', 'Output folder', '.laratype'],
    ['--api-out <file>', 'Separate-repo api.ts (default: <out>/api.ts)'],
    ['--tsconfig <file>', 'tsconfig used to type-check the tree (default: tsconfig.json)'],
  ]

  // The generator reads files only: no provider boots. The tree root comes from app/config/config.ts, imported on its own.
  public async providers() {
    return [];
  }

  public async handle() {
    Console.start("Generating types from the contract tree...");
    const opts = this.opts();
    const startTime = performance.now();

    let result: Awaited<ReturnType<typeof generateTypes>>;
    try {
      result = await runTypesGenerate(cwd(), opts);
    } catch (error) {
      Console.error(error instanceof ScanError ? `[sauf types:generate] ${error.message}` : error instanceof Error ? error.message : error);
      process.exitCode = 1;
      return 1;
    }
    const { tree, files } = result;

    for (const file of files) {
      Console.info(`Generated ${file.path}`);
    }

    Console.success(green(`${tree.contracts.length} contracts, ${files.length} files in ${(performance.now() - startTime).toFixed(2)}ms`));

    return 0;
  }
}

export interface TypesGenerateFlags {
  readonly root?: string;
  readonly base?: string;
  readonly out?: string;
  readonly apiOut?: string;
  readonly tsconfig?: string;
}

/** `sauf types:generate` without the console: config `api.root` / `api.base`, overridden by `--root` / `--base`. */
export async function runTypesGenerate(projectDir: string, flags: TypesGenerateFlags, load?: (url: string) => Promise<unknown>) {
  // Both flags given: the config is not needed, so it is not imported (it may need env or providers)
  const config = flags.root !== undefined && flags.base !== undefined ? {} : await readApiTreeConfig(projectDir, load);
  const tree = resolveApiTree({ root: flags.root, base: flags.base }, config);
  return generateTypes({ projectDir, ...tree, outDir: flags.out, apiOut: flags.apiOut, tsconfig: flags.tsconfig });
}
