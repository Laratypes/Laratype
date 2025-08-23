import { createJiti } from "jiti";
import { globSync } from "glob"
import { getProjectPath } from "@laratype/support";
import type { Command } from "@laratype/console";

const jiti = createJiti(process.cwd());

export const importRootCommands = async () => {
  const path = getProjectPath("src/console/commands/*.ts", false);
  const files = globSync(path, {
    windowsPathsNoEscape: true
  });

  const instances = await Promise.all(files.map(file => jiti.import<typeof Command>(file, {
    default: true,
  })));

  return instances;
}


export default jiti