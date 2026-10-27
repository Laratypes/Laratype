import { fileURLToPath } from "node:url";
import { PassportServiceProvider } from "@laratype/auth";
import { RequestKernel, ResponseKernel } from "@laratype/http";
import { ConfigLoadServiceProvider, DateTimeServiceProvider, EnvLoadServiceProvider, bootProviders, setAppManifest, type AppManifest, type ManifestEntry, type ServiceProvider } from "@laratype/support";
import Serve from "../../../../packages/laratype/src/serve";
import { scanManifest, type ScannedEntry } from "../../../../packages/sauf/src/manifest/scan";

/**
 * Boots `examples/basic` the way `sauf dev` does (docs/v1/build.md › Plugin chain, docs/v1/http.md › Controller
 * resolution): the app manifest from a scan of the project, then the same providers in the same order as
 * `register()` (packages/laratype/src/bootstrap.ts), with `HTTP_APP` on the `Serve` container. No provider is stubbed
 * or skipped; the example's `DatabaseServiceProvider` logs its connection error without MySQL but lets the boot finish.
 *
 * The providers are imported from the workspace sources rather than through `register()`'s `importModule()`, which
 * resolves the built `dist/` packages: the test's app code comes from `src` through the repo aliases, so one copy of
 * every framework module serves the routes.
 */

const projectDir = fileURLToPath(new URL("../..", import.meta.url));

// What examples/basic/README.md asks a developer to set: the Google guard of app/config/auth.ts builds its passport
// strategy at boot, and passport-google-oidc refuses an empty clientID. Dummy values: no test signs in with Google.
process.env.AUTH_GOOGLE_CLIENT_ID ??= "test-client-id";
process.env.AUTH_GOOGLE_CLIENT_SECRET ??= "test-client-secret";

/** Every app module the manifest can name, loaded lazily on first use, as `virtual:laratype/app` does. */
const modules = import.meta.glob([
  "../../app/config/*.ts",
  "../../app/routes/*.ts",
  "../../app/src/models/*.ts",
  "../../app/src/console/commands/*.ts",
  "../../app/database/seeders/*.ts",
  "../../app/database/factories/*.ts",
]);

const entry = (scanned: ScannedEntry): ManifestEntry => {
  const load = modules[`../../${scanned.path}`];
  if (!load) throw new Error(`examples/basic: the manifest scan found ${scanned.path}, but no loader matches it`);
  return { name: scanned.name, path: scanned.path, load };
};

export interface BootedExample {
  /** The Hono app the example's providers registered their routes on. */
  readonly app: ReturnType<typeof Serve.getInstance>;
  /** Runs the providers' `down()` (in reverse) and resets the app for the next test file. */
  readonly stop: () => Promise<void>;
}

export const bootExample = async (): Promise<BootedExample> => {
  const scan = scanManifest(projectDir);
  const manifest: AppManifest = {
    providers: scan.providers && entry(scan.providers),
    configs: scan.kinds.configs.map(entry),
    routes: scan.kinds.routes.map(entry),
    commands: scan.kinds.commands.map(entry),
    models: scan.kinds.models.map(entry),
    migrations: scan.kinds.migrations.map(entry),
    seeders: scan.kinds.seeders.map(entry),
    factories: scan.kinds.factories.map(entry),
    modules: scan.kinds.modules.map(entry),
  };
  setAppManifest(manifest);

  const appProviders = manifest.providers ? await manifest.providers.load().then((mod) => mod.default as Array<typeof ServiceProvider>) : [];
  const providers = [
    EnvLoadServiceProvider,
    ConfigLoadServiceProvider,
    DateTimeServiceProvider,
    RequestKernel,
    ...appProviders,
    PassportServiceProvider,
    ResponseKernel,
  ];
  const cleanups = await bootProviders(Serve.getContainer(), providers);
  return { app: Serve.getInstance(), stop: () => Serve.stop(cleanups) };
};
