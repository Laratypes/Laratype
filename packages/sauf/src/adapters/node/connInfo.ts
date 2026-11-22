import { Console } from "@laratype/console";
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

/**
 * The resolution failure of the optional `@laratype/http` itself: mlly's `Cannot find module @laratype/http imported
 * from ...` and Node's `Cannot find package '@laratype/http' imported from ...`. Anchored on the specifier, so a
 * missing dependency inside an installed copy (the importer is `.../node_modules/@laratype/http/dist/...`) and a
 * look-alike package (`@laratype/httpx`) are the app's failures, not a missing optional package.
 */
const MISSING_HTTP = /^Cannot find (?:module @laratype\/http|package '@laratype\/http') imported from /

/** Whether `error` is the resolution failure of the optional `@laratype/http`: the app does not have the package. */
const isMissingHttpPackage = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown, message?: unknown };
  return code === "ERR_MODULE_NOT_FOUND" && typeof message === "string" && MISSING_HTTP.test(message);
}

/**
 * Set once the missing-package warning printed: per process, because a dev restart or a second copy of the module
 * re-imports this one. A `Symbol.for` flag, as `@laratype/http`'s throttle warnings use, so the copies agree.
 */
const MISSING_HTTP_WARNED = Symbol.for("laratype.sauf.missingHttpWarned")

/**
 * Set once the no-mountConnInfo warning printed, for the same per-process reason. A broken import of a resolvable copy
 * and an older copy without the seam are different causes of the same lost `request.ip()`.
 */
const NO_MOUNT_CONN_INFO_WARNED = Symbol.for("laratype.sauf.noMountConnInfoWarned")

/** Prints `text` the first time this process reaches the warning flagged by `flag`. */
const warnOnce = (flag: symbol, text: string): void => {
  const store = globalThis as { [key: symbol]: true | undefined };
  if (store[flag]) return;
  store[flag] = true;
  Console.warn(text);
}

/** Warns once per process that the optional `@laratype/http` does not resolve, so the IP-keyed limit is off. */
const warnMissingHttp = () => warnOnce(
  MISSING_HTTP_WARNED,
  `[sauf] If this app serves routes with @laratype/http, request.ip() stays undefined and .throttle() routes keyed by IP have no address: @laratype/http does not resolve from the working directory ${process.cwd()} (it is an optional peer of laratype). Install @laratype/http where the app runs and start the app from the project root.`,
)

/** Warns once per process that `@laratype/http` loaded without the seam, so the IP-keyed limit is off. */
const warnWithoutMountConnInfo = () => warnOnce(
  NO_MOUNT_CONN_INFO_WARNED,
  "[sauf] If this app serves routes with @laratype/http, request.ip() stays undefined and .throttle() routes keyed by IP have no address: @laratype/http loaded without mountConnInfo (its import failed and the loader logged that above, or the app has an older copy of the package).",
)

/**
 * Registers the node runtime's `getConnInfo` with `@laratype/http`, so `request.ip()` reads the socket the node server
 * accepted (H30 #299). `sauf`'s node entry and `sauf dev` call it before the app's providers mount their routes: the
 * middleware that carries the getter has to run before them. `@laratype/http` is an optional peer of `laratype` and not
 * a dependency of `sauf`, so it is loaded on demand; an app without it, or with a copy that loads without
 * `mountConnInfo` (an import failure or an older copy), registers nothing, logs one warning per process about the lost
 * IP-keyed rate limit, and `ip()` answers undefined.
 */
export const mountNodeConnInfo = async (app: unknown, load: ModuleLoader = importModule): Promise<void> => {
  let http: HttpModule | undefined;
  try {
    http = await load("@laratype/http", { internal: true }) as HttpModule | undefined;
  }
  catch (error) {
    // support's importModule resolves before it imports: when the optional package itself is absent, this is the
    // resolver's rejection, which warns and skips. Every other rejection is the loader's own and is rethrown. A
    // resolvable module that fails to import is not thrown at all (the loader logs it and returns undefined), so the
    // no-mountConnInfo warning below covers that case.
    if (isMissingHttpPackage(error)) {
      warnMissingHttp();
      return;
    }
    throw error;
  }
  if (typeof http?.mountConnInfo === "function") {
    http.mountConnInfo(app, getNodeConnInfo);
    return;
  }
  warnWithoutMountConnInfo();
};
