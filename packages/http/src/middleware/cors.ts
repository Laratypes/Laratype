import { cors } from "hono/cors";
import { TrieRouter } from "hono/router/trie-router";
import type { Hono, MiddlewareHandler } from "hono";
import { config } from "@laratype/core";

/**
 * CORS from `app/config/cors.ts` (docs/v1/http.md › CORS, H15 #164). Hono's `cors` does the work: matching an origin,
 * answering a preflight and setting the headers. This module validates the typed config, maps it onto Hono's options
 * and mounts it as the first global middleware, so a preflight is answered before routing and an error response keeps
 * the headers.
 */

/** Hono's `CORSOptions` is not exported by `hono/cors`; the `cors()` signature carries it. */
type HonoCorsOptions = NonNullable<Parameters<typeof cors>[0]>;

/** An option of Hono's that is a list, accepting a readonly list: the config is read here, never mutated. */
type ReadonlyList<T> = T extends readonly (infer U)[] ? readonly U[] : T;

/**
 * The `app/config/cors.ts` shape: Hono 4's CORS options (its `origin` may be an async function), with readonly lists,
 * plus `paths`. `origin` is required: a file that turns CORS on must say who may call.
 */
export type CorsConfig = Omit<
  HonoCorsOptions,
  "origin" | "allowMethods" | "allowHeaders" | "exposeHeaders" | "credentials"
> & {
  /** Hono path patterns the middleware runs on; the default is every path (`['*']`). */
  readonly paths?: readonly string[];
  /** `'*'` for every origin, an origin string (matched exactly), a list of them, or a function answering one. */
  readonly origin: ReadonlyList<HonoCorsOptions["origin"]>;
  /** Hono's default `GET, HEAD, PUT, POST, DELETE, PATCH`; a function may answer per origin. */
  readonly allowMethods?: ReadonlyList<HonoCorsOptions["allowMethods"]>;
  /** The preflight's `Access-Control-Allow-Headers`; without it, Hono echoes `Access-Control-Request-Headers`. */
  readonly allowHeaders?: readonly string[];
  /** The `Access-Control-Expose-Headers` of an actual response. */
  readonly exposeHeaders?: readonly string[];
  /** `Access-Control-Max-Age`, in seconds: a whole number of 0 or more. */
  readonly maxAge?: number;
  /** `Access-Control-Allow-Credentials: true`; a browser refuses it with a `'*'` origin. */
  readonly credentials?: boolean;
}

/** The config file, as the diagnostics name it. */
const CONFIG_FILE = "app/config/cors.ts";

/** Every config key, in the order the diagnostics list them. */
const KEYS = ["paths", "origin", "allowMethods", "allowHeaders", "exposeHeaders", "maxAge", "credentials"] as const;

/**
 * A config value as one diagnostic prints it: strings quoted, scalars as they are, and a list or object as JSON when it
 * is short, else its shape. Never throws: a cycle or a `toJSON` that throws falls back to the shape.
 */
const show = (value: unknown): string => {
  if (typeof value === "function") return "a function";
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined || value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const text = JSON.stringify(value);
    if (text !== undefined && text.length <= 120) return text;
  } catch {
    // A cycle: the shape below names it without walking the value
  }
  return Array.isArray(value) ? "an array" : "an object";
};

/** The boot error: every problem of the file at once, so one restart fixes the file (like the env validation). */
const invalidConfig = (problems: readonly string[]): TypeError => {
  const header = `[@laratype/http] Invalid CORS config (${CONFIG_FILE}), ${problems.length} problem`;
  const lines = problems.map((problem) => `- ${problem}`).join("\n");
  return new TypeError(`${header}${problems.length === 1 ? "" : "s"}:\n${lines}`);
};

const isPathPattern = (value: unknown): value is string =>
  typeof value === "string" && (value === "*" || value.startsWith("/"));

/** A header or method name: any non-empty string. Hono joins the list into one header value. */
const isName = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/**
 * An origin as a browser serializes it: `http(s)://host[:port]`, with no path, trailing slash or query. Hono compares
 * it to the `Origin` header by exact string, so `https://app.example.com/` would silently never match.
 */
const isSerializedOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value;
  } catch {
    return false;
  }
};

/**
 * The problem of one origin string, or nothing. `'*'` is the whole-origin form; `'null'` is what a sandboxed iframe, a
 * `data:` page and a `file:` page send, so listing it allows all of them at once.
 */
const originShapeProblem = (value: string, key: string): string | undefined => {
  if (value === "null") return `${key}: 'null' allows sandboxed and file: pages; list real origins`;
  if (value === "*") return undefined;
  if (!isSerializedOrigin(value)) {
    return `${key}: expected a serialized origin (http(s)://host[:port]), got ${show(value)}`;
  }
  return undefined;
};

/** The `paths`, `origin` and Hono options a valid file resolves to. */
interface ResolvedCors {
  paths: readonly string[];
  options: HonoCorsOptions;
}

/**
 * Checks the file's value and maps it onto Hono's options. Every problem is collected and thrown as one `TypeError` at
 * boot; a value Hono would take but a browser refuses (credentials with a `*` origin) is one of them.
 */
const resolveCors = (raw: unknown): ResolvedCors => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw invalidConfig([`expected defineConfig({ ... }), got ${show(raw)}`]);
  }
  const config = raw as Record<string, unknown>;
  const problems: string[] = [];

  for (const key of Object.keys(config)) {
    if (!(KEYS as readonly string[]).includes(key)) {
      problems.push(`'${key}': unknown key (expected ${KEYS.join(", ")})`);
    }
  }

  let paths: readonly string[] = ["*"];
  if (config.paths !== undefined) {
    const value = config.paths;
    if (!Array.isArray(value) || value.length === 0) {
      problems.push(
        `paths: expected a non-empty array of path patterns ('*' or a path starting with '/'), got ${show(value)}`,
      );
    } else {
      value.forEach((path, index) => {
        if (!isPathPattern(path)) {
          const expected = "a path pattern ('*' or a path starting with '/')";
          problems.push(`paths[${index}]: expected ${expected}, got ${show(path)}`);
        }
      });
      if (value.every(isPathPattern)) paths = value;
    }
  }

  let origin: HonoCorsOptions["origin"] | undefined;
  if (config.origin === undefined) {
    problems.push(`origin: required; name the origins, or '*'`);
  } else if (typeof config.origin === "string" || typeof config.origin === "function") {
    if (config.origin === "") {
      problems.push(`origin: expected a non-empty origin string, got ""`);
    } else if (typeof config.origin === "function") {
      origin = config.origin as HonoCorsOptions["origin"];
    } else {
      const problem = originShapeProblem(config.origin, "origin");
      if (problem) problems.push(problem);
      else origin = config.origin;
    }
  } else if (Array.isArray(config.origin) && config.origin.length > 0) {
    let listed = true;
    config.origin.forEach((entry, index) => {
      if (!isName(entry)) {
        problems.push(`origin[${index}]: expected a non-empty origin string, got ${show(entry)}`);
        listed = false;
      }
      // Hono reads a list by exact `includes`, so a `'*'` entry matches no browser: the wildcard is the string form
      else if (entry === "*") {
        problems.push(`origin[${index}]: '*' cannot be a list entry; set origin: '*' for every origin, or list them`);
        listed = false;
      } else {
        const problem = originShapeProblem(entry, `origin[${index}]`);
        if (problem) {
          problems.push(problem);
          listed = false;
        }
      }
    });
    if (listed) origin = config.origin;
  } else {
    problems.push(
      `origin: expected '*' or an origin string, a list of them, or a function, got ${show(config.origin)}`,
    );
  }

  let allowMethods: HonoCorsOptions["allowMethods"] | undefined;
  if (config.allowMethods !== undefined) {
    const value = config.allowMethods;
    if (typeof value === "function") {
      allowMethods = value as HonoCorsOptions["allowMethods"];
    } else if (Array.isArray(value)) {
      value.forEach((method, index) => {
        if (!isName(method)) problems.push(`allowMethods[${index}]: expected an HTTP method name, got ${show(method)}`);
      });
      if (value.every(isName)) allowMethods = value;
    } else {
      problems.push(`allowMethods: expected an array of HTTP method names or a function, got ${show(value)}`);
    }
  }

  const names = (key: "allowHeaders" | "exposeHeaders"): string[] | undefined => {
    const value = config[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
      problems.push(`${key}: expected an array of header names, got ${show(value)}`);
      return undefined;
    }
    value.forEach((name, index) => {
      if (!isName(name)) problems.push(`${key}[${index}]: expected a header name, got ${show(name)}`);
    });
    return value.every(isName) ? value : undefined;
  };
  const allowHeaders = names("allowHeaders");
  const exposeHeaders = names("exposeHeaders");

  let maxAge: number | undefined;
  if (config.maxAge !== undefined) {
    const value = config.maxAge;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      problems.push(`maxAge: expected a whole number of seconds, 0 or more, got ${show(value)}`);
    } else {
      maxAge = value;
    }
  }

  let credentials: boolean | undefined;
  if (config.credentials !== undefined) {
    if (typeof config.credentials !== "boolean") {
      problems.push(`credentials: expected a boolean, got ${show(config.credentials)}`);
    } else {
      credentials = config.credentials;
    }
  }

  // A browser refuses `Access-Control-Allow-Origin: *` on a credentialed request, so Hono would send a pair no browser
  // accepts and every request would fail with no obvious cause. A function origin can answer a real origin, and a `'*'`
  // list entry already failed above, so only the string form is refused here
  if (credentials === true && origin === "*") {
    problems.push(`credentials: true cannot pair with origin '*'; list the origins instead`);
  }

  if (problems.length) throw invalidConfig(problems);

  // No problem was recorded, so `origin` is set (the two are decided together above)
  const options: HonoCorsOptions = { origin: origin! };
  if (allowMethods !== undefined) options.allowMethods = allowMethods;
  if (allowHeaders !== undefined) options.allowHeaders = allowHeaders;
  if (exposeHeaders !== undefined) options.exposeHeaders = exposeHeaders;
  if (maxAge !== undefined) options.maxAge = maxAge;
  if (credentials !== undefined) options.credentials = credentials;
  return { paths, options };
};

/**
 * `config()` types its path against the app's `Register` config interface. The framework reads an optional key no app
 * has to register, so the string overload is reached through this cast. A bare kernel (a test, a kernel booted without
 * the config providers) has no config store yet and mounts no CORS.
 */
const readConfig = config as unknown as (path: string) => unknown;

/** What `config()` throws before the config store is loaded: the one failure that means "no config", not a broken file. */
const NO_CONFIG_STORE =
  "[@laratype/core] config('cors') ran before the configs were loaded " +
  "(ConfigLoadServiceProvider)";

const configuredCors = (): unknown => {
  try {
    return readConfig("cors");
  } catch (error) {
    // Only the missing store mounts nothing: a getter or file that throws fails the boot instead of turning CORS off
    if (error instanceof Error && error.message === NO_CONFIG_STORE) return undefined;
    throw error;
  }
};

/**
 * Hono's own matcher for the `paths` list, built once: one middleware serves the whole list, so overlapping patterns
 * (`['/api/*', '/api/users/*']`) still run `cors()` once per request.
 */
const pathMatcher = (paths: readonly string[]): ((path: string) => boolean) => {
  const router = new TrieRouter<string>();
  for (const path of paths) router.add("ALL", path, path);
  return (path) => router.match("ALL", path)[0].length > 0;
};

/** Whether a `Vary` value already lists `Origin` (or `*` covers every header), as tokens and case-insensitively. */
const varyCoversOrigin = (vary: string): boolean =>
  vary.split(",").some((token) => {
    const name = token.trim().toLowerCase();
    return name === "origin" || name === "*";
  });

/**
 * Appends `Origin` to a response's `Vary`, keeping every other token and adding none twice. Hono 4.9.6 sets `Vary` from
 * the REQUEST's `Vary` header when it has one (`c.req.header("Vary")`), so a client that sends `Vary: x` drops
 * `Vary: Origin` and a shared cache can serve one origin's answer to another site.
 */
const addVaryOrigin = (headers: Headers): void => {
  const vary = headers.get("Vary");
  if (vary === null || vary.trim() === "") headers.set("Vary", "Origin");
  else if (!varyCoversOrigin(vary)) headers.set("Vary", `${vary}, Origin`);
};

/**
 * Wraps Hono's CORS middleware so the FINAL response carries `Vary: Origin`: after `next()`, so a later `c.header()` or
 * a handler's own `Response` is covered, and on error responses. Hono's preflight returns its own `Response` while the
 * context keeps the headers Hono copies over it, so both are written.
 */
const withVaryOrigin = (middleware: MiddlewareHandler): MiddlewareHandler =>
  async (c, next) => {
    const response = await middleware(c, next);
    addVaryOrigin(c.res.headers);
    if (response) addVaryOrigin(response.headers);
    return response;
  };

/**
 * Registers the CORS middleware on the app, from `app/config/cors.ts` (docs/v1/http.md › CORS): no file (or no `cors`
 * key) mounts nothing (same-origin only), and `RequestKernel.boot()` mounts it first, before the routes, so every route
 * answers a preflight and every error response keeps the headers Hono sets before `next()`.
 */
export const mountCors = (app: Hono): void => {
  const raw = configuredCors();
  if (raw === undefined) return;
  const { paths, options } = resolveCors(raw);
  const corsMiddleware = cors(options);
  // A '*' origin needs no Vary, and Hono sends it as is; a single origin, a list and a function get the Vary fix
  const middleware = options.origin === "*" ? corsMiddleware : withVaryOrigin(corsMiddleware);
  if (paths.length === 1 && paths[0] === "*") {
    app.use("*", middleware);
    return;
  }
  const matches = pathMatcher(paths);
  // One registration for the whole list: a request under two overlapping patterns must not run cors() twice
  app.use("*", (c, next) => (matches(c.req.path) ? middleware(c, next) : next()));
};
