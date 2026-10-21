import { createJiti } from "jiti";
import type { AppManifest, ManifestEntry } from "@laratype/support";
import { Console, type Command } from "@laratype/console";

const jiti = createJiti(process.cwd());

/** Loads a manifest entry; in dev, `sauf` passes Vite's `ssrLoadModule` with `fixStacktrace` (the same module id). */
export type EntryLoader = (entry: ManifestEntry) => Promise<Record<string, any>>;

const loadEntry: EntryLoader = (entry) => entry.load();

/** A command class: what `sauf` registers (a constructor with a `signature`). */
const isCommandClass = (value: unknown): value is typeof Command =>
  typeof value === "function" && typeof (value as { signature?: unknown }).signature === "string";

/**
 * The app's command classes: the command files of the app manifest (docs/v1/build.md › Plugin chain). None when the
 * manifest has a scan error: `useAppManifest()` printed it, and the framework commands still run. A file that fails to
 * load is skipped with a warning naming it and its error, as a scan error is: the other commands, `make:*` and
 * `types:generate` still run. A file whose default export is not a command class (a helper) is skipped, with one
 * warning naming the files.
 */
export const importRootCommands = async (manifest: AppManifest, load: EntryLoader = loadEntry) => {
  if (manifest.error !== undefined) return [];
  const modules = await Promise.all(manifest.commands.map(async (entry) => {
    try {
      return { entry, command: (await load(entry)).default as unknown };
    } catch (error) {
      return { entry, error };
    }
  }));
  const failed = modules.filter((m) => "error" in m);
  if (failed.length) {
    const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
    Console.warn(`Skipped ${failed.map(({ entry, error }) => `${entry.path} (${reason(error)})`).join(", ")}: the command file failed to load`);
  }
  const loaded = modules.filter((m) => !("error" in m));
  const skipped = loaded.filter(({ command }) => !isCommandClass(command)).map(({ entry }) => entry.path);
  if (skipped.length) {
    Console.warn(`Skipped ${skipped.join(", ")}: the default export is not a command class (a class with a static signature)`);
  }
  return loaded.map(({ command }) => command).filter(isCommandClass);
}

/** The commands `app/routes/console.ts` lists, if the app has the file. */
export const importRouteConsoleCommands = async (manifest: AppManifest, load: EntryLoader = loadEntry) => {
  if (manifest.error !== undefined) return [];
  const entry = manifest.routes.find((e) => e.name === "console");
  return entry ? ((await load(entry)).default as typeof Command[] | undefined) ?? [] : [];
}

export default jiti
