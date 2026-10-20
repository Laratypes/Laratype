import { Console } from "@laratype/console";
import { setAppManifest, type AppManifest } from "@laratype/support";

/** The dev manifest module, served by `laratype:manifest`. */
export const MANIFEST_ID = "virtual:laratype/app";

const warned = new Set<string>();

/** What `sauf build` writes next to `dist/index.js` and `dist/cli.js`. */
export const MANIFEST_FILE = "app.manifest.js";

/**
 * Loads the app manifest and sets it for the runtime (`appManifest()`). In dev, `load` is Vite's `ssrLoadModule` and
 * the id is the virtual module; in production (`globalThis.__APP_PROD__`, the `dist/cli.js` and `dist/index.js`
 * bundles) it is the file `sauf build` wrote next to the bundle. A manifest with a scan error (`error`) is set too and
 * printed as a warning: `appManifest()` throws it, so only what needs the app fails.
 */
export async function useAppManifest(load: (id: string) => Promise<any> = (id) => import(/* @vite-ignore */ id)): Promise<AppManifest> {
  const id = globalThis.__APP_PROD__ ? new URL(`./${MANIFEST_FILE}`, import.meta.url).href : MANIFEST_ID;
  let manifest: AppManifest;
  try {
    ({ default: manifest } = await load(id) as { default: AppManifest });
  } catch (error) {
    // Production: the bundles were copied, but the app was never built (or dist was cleaned)
    if (globalThis.__APP_PROD__ && (error as { code?: string })?.code === "ERR_MODULE_NOT_FOUND" && String((error as Error).message).includes(MANIFEST_FILE)) {
      throw new Error(`dist/${MANIFEST_FILE} not found: run \`sauf build\``, { cause: error });
    }
    throw error;
  }
  setAppManifest(manifest);
  // Each scan error once per process (`sauf dev` loads the manifest again on every restart)
  if (manifest.error !== undefined && !warned.has(manifest.error)) {
    warned.add(manifest.error);
    Console.warn(manifest.error);
  }
  return manifest;
}
