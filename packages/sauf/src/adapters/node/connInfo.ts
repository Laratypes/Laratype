import { getConnInfo as getNodeConnInfo } from "@hono/node-server/conninfo";
import { importModule } from "@laratype/support";

/** How the node entry loads `@laratype/http`: on demand, as `laratype`'s bootstrap does for the optional peer. */
type ModuleLoader = (id: string, options: { internal: boolean }) => Promise<unknown>

/** The node runtime's Hono `getConnInfo`. */
type GetConnInfo = typeof getNodeConnInfo

/** What it reads of that module: the seam the HTTP package exports for serving adapters (docs/v1/http.md › Request.ip()). */
interface HttpModule {
  mountConnInfo?: (app: unknown, getConnInfo: GetConnInfo) => void
}

/** Whether `error` is the resolution failure of the optional `@laratype/http`: the app does not have the package. */
const isMissingHttpPackage = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown, message?: unknown };
  return code === "ERR_MODULE_NOT_FOUND"
    && typeof message === "string"
    && message.includes("@laratype/http");
}

/**
 * Registers the node runtime's `getConnInfo` with `@laratype/http`, so `request.ip()` reads the socket the node server
 * accepted (H30 #299). `sauf`'s node entry and `sauf dev` call it before the app's providers mount their routes: the
 * middleware that carries the getter has to run before them. `@laratype/http` is an optional peer of `laratype` and not
 * a dependency of `sauf`, so it is loaded on demand; an app without it (or with an older copy) registers nothing, and
 * `ip()` answers undefined.
 */
export const mountNodeConnInfo = async (app: unknown, load: ModuleLoader = importModule): Promise<void> => {
  let http: HttpModule | undefined;
  try {
    http = await load("@laratype/http", { internal: true }) as HttpModule | undefined;
  }
  catch (error) {
    // The loader resolves before it imports (support's importModule), so an app without the optional package rejects
    // here, not with the undefined the guard below already accepted. Any other loader error is the app's: keep it.
    if (isMissingHttpPackage(error)) return;
    throw error;
  }
  if (typeof http?.mountConnInfo === "function") {
    http.mountConnInfo(app, getNodeConnInfo);
  }
};
