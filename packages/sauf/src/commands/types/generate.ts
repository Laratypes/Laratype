import process, { cwd } from "node:process";
import { Command, Console } from "@laratype/console";
import { green } from "kolorist";
import { generateTypes } from "../../typegen";

export default class TypesGenerateCommand extends Command {

  static signature = 'types:generate'

  static description = 'Generate $types.d.ts, .laratype/api/index.gen.ts and the separate-repo api.ts from the contract tree'

  static options = [
    ['--root <dir>', 'Contract tree root, relative to the project', 'app/api'],
    ['--base <path>', 'URL base of the root', '/api'],
    ['--out <dir>', 'Output folder', '.laratype'],
    ['--api-out <file>', 'Separate-repo api.ts (default: <out>/api.ts)'],
    ['--tsconfig <file>', 'tsconfig used to type-check the tree (default: tsconfig.json)'],
  ]

  // The generator reads files only: no provider boots
  public async providers() {
    return [];
  }

  public async handle() {
    Console.start("Generating types from the contract tree...");
    const opts = this.opts();
    const startTime = performance.now();

    let result: Awaited<ReturnType<typeof generateTypes>>;
    try {
      result = await generateTypes({
        projectDir: cwd(),
        root: opts.root,
        base: opts.base,
        outDir: opts.out,
        apiOut: opts.apiOut,
        tsconfig: opts.tsconfig,
      });
    } catch (error) {
      Console.error(error instanceof Error ? error.message : error);
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
