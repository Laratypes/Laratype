import { fileURLToPath } from "node:url";
import type { Context } from "hono";
import type { Container } from "@laratype/core";
import { PassportServiceProvider } from "@laratype/auth";
import { mountConnInfo, RequestKernel, ResponseKernel } from "@laratype/http";
import Serve from "../../../../packages/laratype/src/serve";
import { register } from "../../../../packages/laratype/src/bootstrap";
import { useAppManifest } from "../../../../packages/sauf/src/manifest";

// The JWT guard signs with app config's `key` (Env.get("APP_KEY", "")): a test key lets the swapped AuthManager issue
// and verify real tokens without an .env file.
process.env.APP_KEY ||= "examples-basic-test-key";

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
// Node rejects process.chdir() in a worker thread, so vitest.examples.config.ts pins the examples project to the
// `forks` pool; this helper would fail under `--pool=threads`, which bypasses the project config.
process.chdir(projectDir);

interface JsonResult {
  readonly response: Response;
  readonly body: unknown;
}

export interface BootedExample {
  /** The Hono app the example's providers registered their routes on. */
  readonly app: ReturnType<typeof Serve.getInstance>;
  /** The app container, for the test-only `AuthManager` swap (`support/auth.ts`). */
  readonly container: Container;
  /** Runs the providers' `down()` (in reverse) and resets the app for the next test file. */
  readonly stop: () => Promise<void>;
  /** `app.request()` and the parsed JSON body, for the in-process tests. */
  readonly requestJson: (path: string, init?: RequestInit) => Promise<JsonResult>;
  /** `POST /api/users` with a JSON body. */
  readonly store: (body: unknown, headers?: Record<string, string>) => Promise<JsonResult>;
}

/**
 * The getter `sauf dev`'s node adapter mounts: the in-process `app.request()` has no socket, so a test passes the
 * client address as the request's `env` (`app.request(path, init, { address })`). A request without one has no
 * address, and a `.throttle()` route serves it unthrottled with the documented one-time warning (H30 [#299]).
 */
const addressFromEnv = (context: Context) => ({
  remote: { address: (context.env as { address?: string } | undefined)?.address },
});

export const bootExample = async (): Promise<BootedExample> => {
  // `virtual:laratype/app` (laratype:manifest), whose loaders import the app sources through Vite
  await useAppManifest();
  const providers = await register(false, {
    framework: { RequestKernel, ResponseKernel, PassportServiceProvider },
  });
  // `sauf dev` mounts the adapter's getConnInfo before bootProvider (docs/v1/http.md › Request.ip()); the rate limit
  // reads the captured address, so the test boot must mount one before the providers register their routes.
  mountConnInfo(Serve.getInstance(), addressFromEnv);
  // Resets the Hono app and container when a provider throws, like `sauf dev`'s boot
  const cleanups = await Serve.bootProvider(providers);

  const app = Serve.getInstance();
  const requestJson = async (path: string, init?: RequestInit) => {
    const response = await app.request(path, init);
    return { response, body: await response.json() };
  };

  return {
    app,
    container: Serve.getContainer(),
    stop: () => Serve.stop(cleanups),
    requestJson,
    store: (body: unknown, headers: Record<string, string> = {}) => requestJson("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  };
};
