import { getProjectPath, getRootPackageInfo, resolvePathSync } from "@laratype/support";
import { rollup } from "rollup";
import { Command, Console } from "@laratype/console";
import { green } from "kolorist";
import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { replaceTscAliasPaths } from 'tsc-alias';
import { getPlatformAdapter } from "../utils/build/platform";
import { cpSync } from "fs";

export default class LaratypeBuildCommand extends Command {

  static signature = 'build'

  static description = 'Build the Laratype application'

  static options = [
    ['-p, --platform <platform>', 'Platform to build for', 'node'],
  ]

  // Disable all providers by default
  public async providers() {
    return [];
  }

  public async handle() {
    Console.start("Building Laratype Application...");
    const opts = this.opts();
    const startTime = globalThis.__sauf_start_time || performance.now();

    // Guard check platform adapter
    getPlatformAdapter(opts.platform);

    const rootInfo = await getRootPackageInfo();

    const targets = {
      [resolvePathSync('sauf/resources/app/cli.js')]: getProjectPath('dist/cli.js', false),
      [resolvePathSync('sauf/resources/app/adapters/node/index.js')]: getProjectPath('dist/index.js', false),
    }
    
    for (const sourceFile in targets) {
      const targetFile = targets[sourceFile];
      cpSync(
        sourceFile,
        targetFile,
      );
      
      Console.info(`Generated ${targetFile}`);
    }

    await replaceTscAliasPaths({
      configFile: getProjectPath('tsconfig.build.json', false),
      resolveFullPaths: true,
      resolveFullExtension: '.js',
    })

    const endTime = performance.now();

    Console.success(green(`Build completed in ${(endTime - startTime).toFixed(2)}ms`));

    return 0;

  }
}