import { createJiti } from "jiti";
import { globSync } from "glob"
import { getAppPath } from "@laratype/support";
import type { Command } from "@laratype/console";
import Transpile from "./transplie";
import { pathToFileURL } from "url";

const jiti = createJiti(process.cwd());

export const importRootCommands = async (transpiler: Transpile) => {
  const path = getAppPath("src/console/commands/*.ts", false);
  const files = globSync(path, {
    windowsPathsNoEscape: true
  });

  const runner = await transpiler.getRunner();

  const instances = await Promise.all(files.map(file => runner.ssrLoadModule(pathToFileURL(file).href, {
    fixStacktrace: true,
  }).then((module) => module.default as typeof Command)));

  return instances;
}

export const importRouteConsoleCommands = async (transpiler: Transpile) => {
  const path = getAppPath("routes/console.ts", false);
  const runner = await transpiler.getRunner();

  const module = await runner.ssrLoadModule(pathToFileURL(path).href, {
    fixStacktrace: true,
  });

  return module.default as typeof Command[];
}

export default jiti