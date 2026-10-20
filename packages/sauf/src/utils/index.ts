import { createJiti } from "jiti";
import type { AppManifest, ManifestEntry } from "@laratype/support";
import type { Command } from "@laratype/console";

const jiti = createJiti(process.cwd());

/** Loads a manifest entry; in dev, `sauf` passes Vite's `ssrLoadModule` with `fixStacktrace` (the same module id). */
export type EntryLoader = (entry: ManifestEntry) => Promise<Record<string, any>>;

const loadEntry: EntryLoader = (entry) => entry.load();

/**
 * The app's command classes: the command files of the app manifest (docs/v1/build.md › Plugin chain). None when the
 * manifest has a scan error: `useAppManifest()` printed it, and the framework commands still run.
 */
export const importRootCommands = async (manifest: AppManifest, load: EntryLoader = loadEntry) => {
  if (manifest.error !== undefined) return [];
  return Promise.all(manifest.commands.map(async (entry) => (await load(entry)).default as typeof Command));
}

/** The commands `app/routes/console.ts` lists, if the app has the file. */
export const importRouteConsoleCommands = async (manifest: AppManifest, load: EntryLoader = loadEntry) => {
  if (manifest.error !== undefined) return [];
  const entry = manifest.routes.find((e) => e.name === "console");
  return entry ? ((await load(entry)).default as typeof Command[] | undefined) ?? [] : [];
}

export default jiti
