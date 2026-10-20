import { setAppManifest, type AppManifest } from "@laratype/support";

/** The dev manifest module, served by `laratype:manifest`. */
export const MANIFEST_ID = "virtual:laratype/app";

/** What `sauf build` writes next to `dist/index.js` and `dist/cli.js`. */
export const MANIFEST_FILE = "app.manifest.js";

/**
 * Loads the app manifest and sets it for the runtime (`appManifest()`). In dev, `load` is Vite's `ssrLoadModule` and
 * the id is the virtual module; in production (`globalThis.__APP_PROD__`, the `dist/cli.js` and `dist/index.js`
 * bundles) it is the file `sauf build` wrote next to the bundle.
 */
export async function useAppManifest(load: (id: string) => Promise<any> = (id) => import(/* @vite-ignore */ id)): Promise<AppManifest> {
  const id = globalThis.__APP_PROD__ ? new URL(`./${MANIFEST_FILE}`, import.meta.url).href : MANIFEST_ID;
  const { default: manifest } = await load(id) as { default: AppManifest };
  setAppManifest(manifest);
  return manifest;
}
