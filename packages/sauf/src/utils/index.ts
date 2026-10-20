import { createJiti } from "jiti";
import { appManifest, loadDefault, manifestEntry } from "@laratype/support";
import type { Command } from "@laratype/console";

const jiti = createJiti(process.cwd());

/** The app's command classes: the command files of the app manifest (docs/v1/build.md › Plugin chain). */
export const importRootCommands = async () => {
  return Promise.all(appManifest().commands.map((entry) => loadDefault<typeof Command>(entry)));
}

/** The commands `app/routes/console.ts` lists, if the app has the file. */
export const importRouteConsoleCommands = async () => {
  const entry = manifestEntry("routes", "console");
  return entry ? await loadDefault<typeof Command[]>(entry) ?? [] : [];
}

export default jiti
