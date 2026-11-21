import type { AppManifest, ManifestEntry } from "@laratype/support";

/** A manifest whose only entries are `configs`: every other kind is empty. */
export const manifestWith = (configs: ManifestEntry[]): AppManifest => ({
  configs, routes: [], commands: [], models: [], migrations: [], seeders: [], factories: [], modules: [], lang: [],
});

/** A config entry whose `load()` resolves to `value` as its default export. */
export const entryWithValue = (name: string, value: unknown): ManifestEntry => ({
  name,
  path: `app/config/${name}.ts`,
  load: async () => ({ default: value }),
});

/** A config entry whose `load()` is the given function. */
export const entryLoading = (name: string, load: ManifestEntry["load"]): ManifestEntry => ({
  name,
  path: `app/config/${name}.ts`,
  load,
});
