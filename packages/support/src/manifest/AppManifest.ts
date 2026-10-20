/**
 * The app manifest (docs/v1/build.md › Plugin chain): every app module the framework loads, found at build time.
 * In dev it is the `virtual:laratype/app` module of `sauf`'s `laratype:manifest` plugin; in production, the
 * `dist/app.manifest.js` file `sauf build` writes. The entry (`sauf dev`, `dist/index.js`, `dist/cli.js`) loads it and
 * calls `setAppManifest()` before the providers boot, so the runtime never looks files up by path.
 */

/** One discovered module. `load()` imports it on first use, so a command only loads what it needs. */
export interface ManifestEntry<M = Record<string, any>> {
  /** The file name without its extension: `config`, `User`, `DatabaseSeeder`. */
  readonly name: string;
  /** The source file, relative to the project: `app/src/models/User.ts`. */
  readonly path: string;
  readonly load: () => Promise<M>;
}

export interface AppManifest {
  /** `app/config/providers.ts`: the provider list the app boots, in its order. */
  readonly providers?: ManifestEntry;
  /** `app/config/*.ts` but `providers.ts`, by file name (`config`, `auth`). */
  readonly configs: readonly ManifestEntry[];
  /** `app/routes/*.ts`: `api`, `console`, `channels`. */
  readonly routes: readonly ManifestEntry[];
  readonly commands: readonly ManifestEntry[];
  readonly models: readonly ManifestEntry[];
  readonly migrations: readonly ManifestEntry[];
  readonly seeders: readonly ManifestEntry[];
  readonly factories: readonly ManifestEntry[];
  /** `app/modules/<name>/index.ts`, by folder name. Read by K2 (#153); nothing boots them yet. */
  readonly modules: readonly ManifestEntry[];
}

export type ManifestKind = Exclude<keyof AppManifest, "providers">;

/**
 * Kept on globalThis: in `sauf dev`, sauf's own dist sets it, and the app's copy of @laratype/support (loaded from
 * src by Vite) reads it.
 */
const store = globalThis as { __laratype_manifest?: AppManifest };

export const setAppManifest = (manifest: AppManifest) => {
  store.__laratype_manifest = manifest;
};

/** The manifest the entry set. Throws when there is none: the app was started without `sauf`. */
export const appManifest = (): AppManifest => {
  const manifest = store.__laratype_manifest;
  if (!manifest) {
    throw new Error("No app manifest: start the app with `sauf dev`, or `node dist/index.js` after `sauf build` (docs/v1/build.md › Plugin chain)");
  }
  return manifest;
};

/** The first entry of a kind with that name (both project layouts may have one: the 0.5 one comes first). */
export const manifestEntry = (kind: ManifestKind, name: string): ManifestEntry | undefined =>
  appManifest()[kind].find((entry) => entry.name === name);

/** Loads an entry and returns its default export. */
export const loadDefault = async <T = unknown>(entry: ManifestEntry): Promise<T> => (await entry.load()).default as T;
