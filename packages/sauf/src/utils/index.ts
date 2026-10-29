import { createJiti } from "jiti";
import type { AppManifest, ManifestEntry } from "@laratype/support";
import { Console, type CommandClass, type ConsoleCommand, isConsoleCommand } from "@laratype/console";

const jiti = createJiti(process.cwd());

/** Loads a manifest entry; in dev, `sauf` passes Vite's `ssrLoadModule` with `fixStacktrace` (the same module id). */
export type EntryLoader = (entry: ManifestEntry) => Promise<Record<string, any>>;

const loadEntry: EntryLoader = (entry) => entry.load();

/** A command class: a constructor with a `signature`. Closure commands live in `app/routes/console.ts` only. */
const isCommandClass = (value: unknown): value is CommandClass =>
  typeof value === "function" && typeof (value as { signature?: unknown }).signature === "string";

/** The warning for a command file that failed to load: its path, then the error's stack. */
const warnFailed = (entry: ManifestEntry, error: unknown) =>
  Console.warn(`Skipped ${entry.path}: the command file failed to load\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);

/**
 * The app's command classes: the command files of the app manifest (docs/v1/build.md › Plugin chain). None when the
 * manifest has a scan error: `useAppManifest()` printed it, and the framework commands still run. A file that fails to
 * load is skipped with a warning naming it, with its error and stack, as a scan error is: the other commands, `make:*`
 * and `types:generate` still run. A default export that is not a command class is skipped, with one warning naming
 * the files; a closure command belongs in `app/routes/console.ts`.
 */
export const importRootCommands = async (manifest: AppManifest, load: EntryLoader = loadEntry): Promise<CommandClass[]> => {
  if (manifest.error !== undefined) return [];
  const modules = await Promise.all(manifest.commands.map(async (entry) => {
    try {
      return { entry, command: (await load(entry)).default as unknown };
    } catch (error) {
      return { entry, error };
    }
  }));
  for (const { entry, error } of modules.filter((m) => "error" in m)) warnFailed(entry, error);
  const loaded = modules.filter((m) => !("error" in m));
  const skipped = loaded.filter(({ command }) => !isCommandClass(command)).map(({ entry }) => entry.path);
  if (skipped.length) {
    Console.warn(`Skipped ${skipped.join(", ")}: the default export is not a command class (a class with a static signature)`);
  }
  return loaded.map(({ command }) => command).filter(isCommandClass);
};

/**
 * The commands `app/routes/console.ts` lists, if the app has the file. The default export is an array of command
 * classes and closure commands. One that fails to load (it imports a broken command file) is skipped with the same
 * warning as a command file.
 */
export const importRouteConsoleCommands = async (manifest: AppManifest, load: EntryLoader = loadEntry): Promise<ConsoleCommand[]> => {
  if (manifest.error !== undefined) return [];
  const entry = manifest.routes.find((e) => e.name === "console");
  if (!entry) return [];
  try {
    const value = (await load(entry)).default as unknown;
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      Console.warn(`Skipped ${entry.path}: the default export is not an array of commands`);
      return [];
    }
    const registered = value.filter(isConsoleCommand);
    if (registered.length !== value.length) {
      const skipped = value.length - registered.length;
      Console.warn(`Skipped ${skipped} ${skipped === 1 ? "entry" : "entries"} of ${entry.path}: not a command (a class with a static signature, or a closure from command())`);
    }
    return registered;
  } catch (error) {
    warnFailed(entry, error);
    return [];
  }
};

export default jiti;
