import { fileURLToPath } from "node:url";
import { PassportServiceProvider } from "@laratype/auth";
import { RequestKernel, ResponseKernel } from "@laratype/http";
import { bootProviders } from "@laratype/support";
import Serve from "../../../../packages/laratype/src/serve";
import { register } from "../../../../packages/laratype/src/bootstrap";
import { useAppManifest } from "../../../../packages/sauf/src/manifest";

/**
 * Boots `examples/basic` the way `sauf dev` does (docs/v1/build.md › Plugin chain, docs/v1/http.md › Controller
 * resolution): the app manifest from sauf's `laratype:manifest` plugin (vitest.examples.config.ts), then `register()`'s
 * provider list, with `HTTP_APP` on the `Serve` container. No provider is stubbed or skipped; the example's
 * `DatabaseServiceProvider` logs its connection error without MySQL but lets the boot finish.
 *
 * The framework providers are imported from the workspace sources (the repo aliases) rather than through `register()`'s
 * `importModule()`, which resolves the built `dist/` packages. Passing them to `register()` keeps the order in one place
 * (packages/laratype/src/bootstrap.ts), so the test boot cannot drift from `sauf dev`.
 */

const projectDir = fileURLToPath(new URL("../..", import.meta.url));

// `EnvLoadServiceProvider` and `@laratype/log` resolve from process.cwd(): run from the repo root, the tests would load
// the root `.env` and write `storage/logs/laratype.log` there (E5 #343). Point the process at the example instead.
process.chdir(projectDir);

export interface BootedExample {
  /** The Hono app the example's providers registered their routes on. */
  readonly app: ReturnType<typeof Serve.getInstance>;
  /** Runs the providers' `down()` (in reverse) and resets the app for the next test file. */
  readonly stop: () => Promise<void>;
  /** `app.request()` and the parsed JSON body, for the in-process tests. */
  readonly requestJson: (path: string, init?: RequestInit) => Promise<{ response: Response; body: any }>;
  /** `POST /api/users` with a JSON body. */
  readonly store: (body: unknown) => Promise<{ response: Response; body: any }>;
}

export const bootExample = async (): Promise<BootedExample> => {
  // `virtual:laratype/app` (laratype:manifest), whose loaders import the app sources through Vite
  await useAppManifest();
  const providers = await register(false, {
    framework: { RequestKernel, ResponseKernel, PassportServiceProvider },
  });

  let cleanups: Array<() => Promise<void>>;
  try {
    cleanups = await bootProviders(Serve.getContainer(), providers);
  } catch (error) {
    // As Serve.bootProvider: a failed boot must not leave a half-booted app for the next test
    Serve.down();
    throw error;
  }

  const app = Serve.getInstance();
  const requestJson = async (path: string, init?: RequestInit) => {
    const response = await app.request(path, init);
    return { response, body: await response.json() };
  };

  return {
    app,
    stop: () => Serve.stop(cleanups),
    requestJson,
    store: (body: unknown) => requestJson("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  };
};
