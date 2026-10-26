import type { Context, Hono, Next } from "hono";
import { API_NODE, apiRoutes, contractEndpoints, isApiNode, isApiRoot, isEndpoint } from "@laratype/contract";
import type { API_ROOT, AnyContract, Api, ApiEntry, ApiRoute } from "@laratype/contract";
import { MetaDataKey } from "@laratype/support";
import Controller from "../../controller/Controller";
import RequestKernel from "../../request/Request";
import type { KernelRouteParams, RouteParams } from "../../contracts/Route";
import type {
  AdHocMethod,
  AdHocRouteEntry,
  ApiRouteBuilder,
  ContractRouteOptions,
  ApiRouteItem,
  CheckApiRoutes,
  ControllerClass,
  MiddlewareClass,
  MountedContract,
  MountedRoute,
  MountedScope,
  RouteEntry,
  ScopeRouteOptions,
  UnenforcedCap,
} from "./types";
import { UNENFORCED_NOTICE } from "./types";
import { throttled } from "./throttle";

const fail = (message: string): never => {
  throw new Error(`[@laratype/http] Route.api: ${message}`);
};

/** Runtime `r`; its types come from `ApiRouteBuilder<A>`. */
class RouteBuilder {
  /** `entries`: the API tree's, so `r.contract()` can name the contract in its errors. */
  constructor(
    readonly stack: readonly MiddlewareClass[] = [],
    private readonly entries: readonly TreeEntry[] = [],
  ) {}

  middleware(...middleware: MiddlewareClass[]) {
    return new RouteBuilder([...this.stack, ...middleware], this.entries);
  }

  contract(contract: object, controller: ControllerClass, options?: ContractRouteOptions<object>): MountedContract<object> {
    // A copy: mutating the options (or their endpoints map) after r.contract() must not change the routes. Whether the
    // originals are plain is decided now, as the copy drops inherited keys. A contract that is not in the tree is
    // reported by Route.api
    const { copy, issue } = copyOptions(options);
    const names = mountedEntries(this.entries, contract).map((e) => e.name);
    if (issue !== undefined && names.length) fail(`contract "${names.join('", "')}": ${issue}`);
    const mounted = Object.freeze({ kind: "contract" as const, contract, controller, middleware: this.stack, options: copy });
    return mounted;
  }

  scope(dir: string, options: ScopeRouteOptions): MountedScope {
    if (typeof options?.policy !== "function") fail(`r.scope('${dir}') needs { policy }`);
    return Object.freeze({ kind: "scope", dir, policy: options.policy, middleware: this.stack });
  }

  get(path: string, handler: MountedRoute["handler"]) { return this.route("get", path, handler); }
  post(path: string, handler: MountedRoute["handler"]) { return this.route("post", path, handler); }
  put(path: string, handler: MountedRoute["handler"]) { return this.route("put", path, handler); }
  patch(path: string, handler: MountedRoute["handler"]) { return this.route("patch", path, handler); }
  delete(path: string, handler: MountedRoute["handler"]) { return this.route("delete", path, handler); }

  /** An ad-hoc route (H12 #139): served at `path` as written, with no contract. */
  private route(method: AdHocMethod, path: string, handler: MountedRoute["handler"]): MountedRoute {
    if (typeof path !== "string" || !path.startsWith("/")) fail(`r.${method}('${String(path)}'): the path must start with "/"`);
    if (typeof handler !== "function") fail(`r.${method}('${path}') needs a handler function`);
    return Object.freeze({ kind: "route", method, path, handler, middleware: this.stack });
  }
}

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

/**
 * On the frozen `options` copy `copyOptions` builds: the plainness issue `r.contract()` could not report there because
 * its builder had no tree entry to name the contract, or `undefined` when the options are plain. plan() reads it once it
 * names the contract. Enumerable, so a spread of the options keeps the issue (spread copies symbol keys); pinned to the
 * copy and non-configurable, so options rebuilt from scratch are checked again.
 */
const PLAIN_ISSUE = Symbol("laratype.http.checkedContractOptions");

/**
 * A frozen copy of every own string key on a `null` prototype, so nothing inherited is read later (not even from a
 * polluted `Object.prototype`) and a non-enumerable key is checked like any other.
 */
const frozenCopy = (value: object, map: (key: string, item: unknown) => unknown = (_, item) => item): object => {
  const copy: object = Object.create(null);
  // defineProperty, not assignment: an own "__proto__" key stays a key instead of setting the prototype
  for (const key of Object.getOwnPropertyNames(value)) {
    Object.defineProperty(copy, key, { value: map(key, (value as Record<string, unknown>)[key]), enumerable: true });
  }
  return copy;
};

/**
 * Why `options` or its `endpoints` map is not plain: an inherited enumerable key, whose option or callback would be
 * dropped (which fails open for auth middleware), or a prototype other than `Object.prototype` or `null` (a deeper
 * chain could hide a non-enumerable inherited callback).
 */
const plainIssue = (label: string, value: object): string | undefined => {
  for (const key in value) if (!Object.hasOwn(value, key)) return `${label}.${key} is inherited: ${label} must have own keys only`;
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return `${label} must have Object.prototype or null as its prototype, not a class instance or an Object.create(base) object`;
  return undefined;
};

/**
 * Frozen copies of `r.contract()` options and their `endpoints` map, each key read once, with the `plainIssue` of the
 * originals. Anything else is returned as is, for `checkOptions` to report.
 */
const copyOptions = (options: unknown): { copy: ContractRouteOptions<object> | undefined; issue: string | undefined } => {
  if (!isObject(options)) return { copy: options as ContractRouteOptions<object> | undefined, issue: undefined };
  let issue = plainIssue("options", options);
  const copy = frozenCopy(options, (key, item) => {
    if (key !== "endpoints" || !isObject(item)) return item;
    issue ??= plainIssue("endpoints", item);
    return Object.freeze(frozenCopy(item));
  });
  // Enumerable, so `{ ...options }` keeps the issue; no string key, so every option check sees the same keys
  Object.defineProperty(copy, PLAIN_ISSUE, { value: issue, enumerable: true });
  return { copy: Object.freeze(copy) as ContractRouteOptions<object>, issue };
};

/** The tree entries a mounted contract names: by its tree node (one), or by the contract value (every entry holding it). */
const mountedEntries = (entries: readonly TreeEntry[], contract: unknown) =>
  entries.filter((e) => e.node === contract || e.entry.contract === contract);

interface TreeEntry {
  readonly name: string;
  readonly entry: ApiEntry;
  /** The tree node holding the contract (`appApi.users.posts`), which `r.contract()` also takes. */
  readonly node: object;
}

/**
 * The mounted contracts of an API tree with their scope folders, depth-first: `apiRoutes()` gives the routes but not
 * the entries. The root, its nodes and endpoints are told by their brands, so a value that is not a `defineApi` tree throws.
 */
const treeEntries = (api: unknown): TreeEntry[] => {
  if (!isApiRoot(api)) return fail("expected the appApi tree built with defineApi");
  const out: TreeEntry[] = [];
  const walk = (node: object) => {
    for (const child of Object.values(node)) {
      if (isEndpoint(child)) continue;
      if (!isApiNode(child)) return fail("expected the appApi tree built with defineApi");
      const info = child[API_NODE];
      if (info.entry) out.push({ name: info.name, entry: info.entry as ApiEntry, node: child });
      walk(child);
    }
  };
  walk(api);
  return out;
};

const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

/** `api.example.com`: a hostname of non-empty labels with no leading or trailing hyphen; no scheme, port or path. */
const checkDomain = (domain: string) => {
  if (typeof domain !== "string" || domain.length > 253 || !domain.split(".").every((label) => label.length <= 63 && LABEL.test(label))) {
    fail(`.domain("${domain}") must be a hostname, such as "api.example.com"`);
  }
  return domain.toLowerCase();
};

/**
 * The request hostname from the `Host` header (never `X-Forwarded-Host`), without the port (dev Host headers carry
 * `:3000`; `[::1]:3000` keeps its brackets) and one trailing dot (`api.example.com.`). Without a Host header (an
 * in-process `app.request()`), the request URL's host.
 */
const hostname = (c: Context) => {
  const host = (c.req.header("host") ?? new URL(c.req.url).host).toLowerCase();
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
  return name.replace(/\.$/, "");
};

/**
 * Builds the routes of `Route.api(appApi, (r) => [...])` and checks them at runtime as the types do:
 * every contract of the tree is mounted once, every `r.scope()` names a scope folder, and every scope with
 * `authorize` has a policy. Ad-hoc routes (`r.get()`, ...) are kept apart from the contract routes.
 */
const plan = (api: unknown, entries: readonly TreeEntry[], items: readonly ApiRouteItem[]): { routes: RouteEntry[]; adHoc: AdHocRouteEntry[] } => {
  if (!Array.isArray(items)) fail("the routes callback must return an array of r.contract(), r.scope() and ad-hoc routes (r.get(), ...)");

  const scopeDirs = new Map<string, boolean>();
  for (const { entry } of entries) for (const { scope, dir } of entry.scopes) scopeDirs.set(dir, scope.authorize === true || scopeDirs.get(dir) === true);

  const scopes = new Map<string, MountedScope>();
  // Keyed by tree name: a tree node names one contract, a contract value every entry that holds it
  const contracts = new Map<string, MountedContract<object>>();
  const adHoc: AdHocRouteEntry[] = [];
  for (const item of items) {
    if (item?.kind === "scope") {
      if (!scopeDirs.has(item.dir)) fail(`"${item.dir}" is not a scope folder of the API tree (folders: ${[...scopeDirs.keys()].map((d) => `"${d}"`).join(", ") || "none"})`);
      if (scopes.has(item.dir)) fail(`scope "${item.dir}" is mounted twice`);
      scopes.set(item.dir, item);
    } else if (item?.kind === "contract") {
      const matched = mountedEntries(entries, item.contract);
      const names = matched.map((e) => e.name);
      if (names.length === 0) fail("a mounted contract is not in the API tree");
      const controller = item.controller;
      if (typeof controller !== "function") {
        fail(`contract "${names.join('", "')}": r.contract() got ${String(controller)} as its controller (a circular import?)`);
      }
      // An item built without r.contract() (untyped callers) is checked for plainness and copied here, as are its
      // options when they carry no issue: r.contract() pins the issue it could not report, when its builder had no tree
      // entry, to the frozen copy of the options
      const pinned = isObject(item.options) ? (item.options as { readonly [PLAIN_ISSUE]?: string })[PLAIN_ISSUE] : undefined;
      const { copy: options, issue } = pinned !== undefined ? { copy: item.options, issue: pinned } : copyOptions(item.options);
      if (issue !== undefined) fail(`contract "${names.join('", "')}": ${issue}`);
      checkOptions(names, matched[0]!.entry.contract, options);
      const twice = names.filter((name) => contracts.has(name));
      if (twice.length) fail(`contract "${twice.join('", "')}" is mounted twice`);
      const stored = pinned !== undefined ? item : Object.freeze({ kind: "contract" as const, contract: item.contract, controller, middleware: item.middleware, options });
      for (const name of names) contracts.set(name, stored);
    } else if (item?.kind === "route") {
      adHoc.push(adHocEntry(item));
    } else {
      fail("the routes callback must return r.contract(), r.scope() and ad-hoc route (r.get(), ...) items");
    }
  }

  const missing = entries.filter((e) => !contracts.has(e.name)).map((e) => e.name);
  if (missing.length) fail(`contract "${missing.join('", "')}" is not mounted (add r.contract())`);
  for (const [dir, authorize] of scopeDirs) {
    if (authorize && !scopes.has(dir)) fail(`scope "${dir}" has authorize but no policy (add r.scope('${dir}', { policy }))`);
  }

  const byName = new Map(entries.map((e) => [e.name, e.entry]));
  const routes = (apiRoutes(api as Api) as ApiRoute[]).map((route): RouteEntry => {
    const key = route.name.slice(route.name.lastIndexOf(".") + 1);
    const name = route.name.slice(0, route.name.lastIndexOf("."));
    const entry = byName.get(name)!;
    const mounted = contracts.get(name)!;
    if (!isHandler(mounted.controller, key)) {
      fail(`${route.name}: ${mounted.controller.name} has no method "${key}" (handlers must be class methods, not arrow-function fields)`);
    }
    // The endpoint's status is the source of truth: a 0.5 status decorator that disagrees would be overridden silently
    const decorated = statusMetadata(mounted.controller, key);
    if (decorated !== undefined && decorated !== route.endpoint.def.status) {
      fail(
        `${route.name}: ${mounted.controller.name}.${key} has status ${decorated} from its status decorator, but the endpoint declares ${route.endpoint.def.status}: ` +
          `declare .response(schema, ${decorated}) on the endpoint, or drop the decorator`,
      );
    }
    const endpointMiddleware = endpointStack(mounted.options, key, route.name);
    const scopeItems = entry.scopes.map(({ dir }) => scopes.get(dir)).filter((s): s is MountedScope => s !== undefined);
    return Object.freeze({
      ...route,
      controller: Object.freeze([mounted.controller, key] as const),
      // One builder can mount a scope and a contract: each middleware runs once, at its first position
      middleware: Object.freeze([...new Set([...scopeItems.flatMap((s) => s.middleware), ...mounted.middleware, ...endpointMiddleware])]),
      policies: Object.freeze(scopeItems.map((s) => Object.freeze({ dir: s.dir, policy: s.policy }))),
      policy: mounted.options?.policy,
      unenforced: unenforcedCaps(route),
      domain: undefined,
    });
  });
  checkAdHocPaths(routes, adHoc);
  return { routes, adHoc };
};

/**
 * The paths a route matches, with param names dropped: `/users/:user/posts/:id{[0-9]+}` → `/users/:/posts/:{[0-9]+}`
 * (a trailing slash counts, for Hono's strict routing). Hono serves a last optional param (`/posts/:id?`) as two
 * routes, `/posts` and `/posts/:`.
 */
const routeShapes = (path: string): string[] => {
  const parts = segments(path).map((segment) => segment.replace(/^:[^{?]*/, ":"));
  const shape = (list: string[]) => `/${list.join("/")}${path.length > 1 && path.endsWith("/") ? "/" : ""}`;
  const last = parts.at(-1);
  if (last?.startsWith(":") && last.endsWith("?")) return [shape(parts.slice(0, -1)), shape([...parts.slice(0, -1), last.slice(0, -1)])];
  return [shape(parts)];
};

/**
 * Hono answers with the first of two routes with the same method and path, so a second one would never run: an
 * ad-hoc route may not repeat a contract route or another ad-hoc route of the group (`/items/:id` repeats `/items/:item`).
 */
const checkAdHocPaths = (routes: readonly RouteEntry[], adHoc: readonly AdHocRouteEntry[]) => {
  const served = new Map<string, string>();
  const serve = (method: string, path: string, name: string) => {
    // The first one wins, as in Hono: it is the route that answers
    for (const shape of routeShapes(path)) if (!served.has(`${method} ${shape}`)) served.set(`${method} ${shape}`, name);
  };
  for (const route of routes) serve(route.method, route.path, route.name);
  for (const route of adHoc) {
    const other = routeShapes(route.path).map((shape) => served.get(`${route.method} ${shape}`)).find((name) => name !== undefined);
    if (other !== undefined) fail(`r.${route.method}('${route.path}') is the same route as ${other}`);
    serve(route.method, route.path, `another r.${route.method}('${route.path}')`);
  }
};

/** The registry entry of `r.get(path, handler)`: no name, contract or controller, and no capabilities to enforce. */
const adHocEntry = (item: MountedRoute): AdHocRouteEntry =>
  Object.freeze({
    method: item.method,
    path: item.path,
    name: undefined,
    controller: undefined,
    handler: item.handler,
    middleware: Object.freeze([...new Set(item.middleware)]),
    domain: undefined,
  });

/**
 * The options of `r.contract(c, Ctrl, { policy, endpoints })`, as copied by `copyOptions` (whose plainness check comes
 * first): `policy` is a class, and every `endpoints` key is an endpoint of the contract with a callback.
 */
const checkOptions = (names: readonly string[], contract: object, options: ContractRouteOptions<object> | undefined) => {
  const at = `contract "${names.join('", "')}"`;
  if (options !== undefined && (typeof options !== "object" || options === null)) fail(`${at}: r.contract() options must be { policy?, endpoints? }`);
  // A misspelled key (`endpoint`) would drop its middleware silently, as an inherited one would
  const unknown = options === undefined ? undefined : Object.keys(options).find((key) => key !== "policy" && key !== "endpoints");
  if (unknown !== undefined) fail(`${at}: r.contract() options must be { policy?, endpoints? }, not options.${unknown}`);
  if (options?.policy !== undefined && typeof options.policy !== "function") fail(`${at}: { policy } must be a policy class`);
  // As the route proof does, and as a scope with `authorize` needs its r.scope() policy: an endpoint with its own
  // .authorize() needs the contract's policy. This fires when the flag is true at runtime; the route proof is stricter on
  // purpose and wants a policy for any boolean `.authorize(flag)`. Its methods are the type check's (running it is A3 #121)
  const contractKeys = contractEndpoints(contract as AnyContract);
  if (options?.policy === undefined) {
    const authorized = contractKeys.find(([, e]) => e.def.authorize === true);
    if (authorized) fail(`${names[0]}.${authorized[0]}: endpoint has .authorize() but r.contract() has no { policy }`);
  }
  if (options === undefined) return;
  const endpoints: Record<string, unknown> | undefined = options.endpoints;
  if (endpoints === undefined) return;
  if (typeof endpoints !== "object" || endpoints === null) fail(`${at}: { endpoints } must map endpoint names to (r) => r.middleware(...)`);
  const keys = new Set(contractKeys.map(([key]) => key));
  for (const key of Object.keys(endpoints!)) {
    if (!keys.has(key)) fail(`${at}: endpoints.${key} is not an endpoint of the contract (endpoints: ${[...keys].map((k) => `"${k}"`).join(", ")})`);
    if (!isCallback(endpoints![key])) fail(`${at}: endpoints.${key} must be a callback, (r) => r.middleware(...)`);
  }
};

/**
 * A function that can be called: not a class (a middleware class compiles under a key typed `Function`, such as
 * hasOwnProperty). A class source starts with the `class` keyword, then whitespace, a comment or `{`, and never a `(`
 * after them; a method shorthand (`classes(r) {}`, `class$(r) {}`, `class /* c *\/ (r) {}`) has one. A bound class or a
 * Proxy of one prints `[native code]` and gets past this check: calling it then throws its own TypeError.
 */
const isCallback = (value: unknown) => {
  if (typeof value !== "function") return false;
  const source = Function.prototype.toString.call(value);
  if (!/^class[\s{/]/.test(source)) return true;
  const rest = source.slice(5).replace(/^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*/, "");
  return rest.startsWith("(");
};

/** The middleware of one endpoint's `endpoints` callback, run on a fresh builder. */
const endpointStack = (options: ContractRouteOptions<object> | undefined, key: string, name: string): readonly MiddlewareClass[] => {
  const endpoints = options?.endpoints as Record<string, (r: RouteBuilder) => unknown> | undefined;
  // Own keys only: an endpoint named toString must not pick up Object.prototype.toString
  if (endpoints === undefined || !Object.hasOwn(endpoints, key)) return [];
  const callback = endpoints[key]!;
  const built = callback(new RouteBuilder());
  if (!(built instanceof RouteBuilder)) fail(`${name}: endpoints.${key} must return the builder it gets, (r) => r.middleware(...)`);
  return (built as RouteBuilder).stack;
};

/**
 * What the router does not enforce yet for a route: its resolved `auth` / `authorize` (#105, #121) and the
 * validation of its body, query and headers schemas (#106). The one place that decides it: the mount warning and
 * `sauf route:list` both read `RouteEntry.unenforced`.
 */
const unenforcedCaps = (route: ApiRoute): readonly UnenforcedCap[] => {
  const { query, body, headers } = route.endpoint.def;
  return Object.freeze([
    ...(route.auth ? (["auth"] as const) : []),
    ...(route.authorize ? (["authorize"] as const) : []),
    ...(query || body || headers ? (["validation"] as const) : []),
  ]);
};

/**
 * A handler is a method of the controller class or a class between it and the base `Controller` (or `Object`):
 * never `constructor`, an `Object.prototype` method or a base `Controller` method.
 */
const isHandler = (controller: ControllerClass, key: string): boolean => {
  if (key === "constructor") return false;
  for (let proto = controller.prototype; proto && proto !== Controller.prototype && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    const own = Object.getOwnPropertyDescriptor(proto, key);
    if (own) return typeof own.value === "function";
  }
  return false;
};

/** The 0.5 `@UseStatusCode` metadata of a handler, if `reflect-metadata` is loaded. */
const statusMetadata = (controller: ControllerClass, key: string): number | undefined => {
  const getMetadata = (Reflect as { getMetadata?: (key: unknown, target: object, property: string) => unknown }).getMetadata;
  const value = getMetadata?.(MetaDataKey.CONTROLLER_STATUS_CODE, controller.prototype, key);
  return typeof value === "number" ? value : undefined;
};

/**
 * The route lists the warning printed, per process: dev restarts re-mount the same routes (one list per `Route.api`
 * group) and must not repeat it. Capped, dropping the oldest, so it never grows without bound.
 */
const WARNED = Symbol.for("laratype.http.unenforcedWarned");
const WARNED_MAX = 32;

/** One warning per process and route set: until #105 / #121 / #106 such a route skips those checks. */
const warnUnenforced = (routes: readonly RouteEntry[]) => {
  const list = routes.filter((route) => route.unenforced.length).map((route) => `${route.name} (${route.unenforced.join(", ")})`);
  if (list.length === 0) return;
  const store = globalThis as { [WARNED]?: Set<string> };
  const warned = (store[WARNED] ??= new Set());
  const key = list.join(", ");
  if (warned.has(key)) return;
  warned.add(key);
  if (warned.size > WARNED_MAX) warned.delete(warned.values().next().value!);
  console.warn(`[@laratype/http] Route.api: ${UNENFORCED_NOTICE}, so these routes skip those checks: ${list.join(", ")}`);
};

/** Whether a param pattern can match `/`: an unescaped `.`, a `/`, a negated class `[^...]`, or `\S`, `\W`, `\D`. */
const spansSegments = (pattern: string) => /(^|[^\\])\.|\/|\[\^|\\[SWD]/.test(pattern);

/**
 * 0 for a static segment, 0.5 for a param constrained to one segment (`:id{[0-9]+}`, more specific than a plain one),
 * 1 for a param (`:user`, `:id?`), 1.5 for a regex param that can span segments (`:path{.+}`), 2 for a wildcard.
 */
const segmentRank = (segment: string) => {
  if (!segment.startsWith(":")) return segment.includes("*") ? 2 : 0;
  const open = segment.indexOf("{");
  if (open === -1) return 1;
  return spansSegments(segment.slice(open + 1, segment.lastIndexOf("}"))) ? 1.5 : 0.5;
};

/** The path segments, keeping a `/` inside a regex pattern (`:file{.+/.+}`) in its segment, as the contract types do. */
const segments = (path: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of path) {
    if (char === "/" && depth === 0) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") depth = Math.max(0, depth - 1);
    current += char;
  }
  if (current) out.push(current);
  return out;
};

/**
 * The routes sorted so a static segment comes before a param or a wildcard at the same position, comparing the
 * segments left to right (stable, so equal routes keep their tree order). Without it a parent's param route would
 * shadow a child's static one: `users.show` (`/api/users/:user`) registered first answers `GET /api/users/me` of
 * `users.me.index`.
 */
const registrationOrder = <T extends { readonly path: string }>(routes: readonly T[]): T[] => {
  const ranks = new Map(routes.map((route) => [route, segments(route.path).map(segmentRank)]));
  return [...routes].sort((a, b) => {
    const ra = ranks.get(a)!;
    const rb = ranks.get(b)!;
    for (let i = 0; i < Math.min(ra.length, rb.length); i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
    return ra.length - rb.length;
  });
};

/** What `RequestKernel` runs for a route: its controller method, or the handler of an ad-hoc route. */
const routeParams = (route: RouteEntry | AdHocRouteEntry): KernelRouteParams => {
  if (route.controller === undefined) {
    return { method: route.method, path: route.path, modelBinding: false, handler: route.handler, middleware: [...route.middleware] };
  }
  return {
    method: route.method,
    path: route.path,
    name: route.name,
    status: route.endpoint.def.status,
    modelBinding: false,
    endpoint: route.endpoint,
    controller: route.controller as unknown as RouteParams["controller"],
    middleware: [...route.middleware],
  };
};

/** The routes of one `Route.api(...)`, checked and ready to mount. */
export class ApiRoutes {
  /** One entry per contract route, depth-first in tree order. */
  public readonly routes: readonly RouteEntry[];
  /** The ad-hoc routes (`r.get()`, ...), in callback order. They have no contract, so they are not in `routes`. */
  public readonly adHoc: readonly AdHocRouteEntry[];

  /** Built by `Route.api()` only: `@laratype/http` exports the type, not the constructor. */
  constructor(routes: readonly RouteEntry[], adHoc: readonly AdHocRouteEntry[]) {
    this.routes = Object.freeze([...routes]);
    this.adHoc = Object.freeze([...adHoc]);
  }

  /** Serves these routes on `domain` only (the request port is ignored). Other hosts fall through to the next route. */
  domain(domain: string): ApiRoutes {
    const host = checkDomain(domain);
    return new ApiRoutes(
      this.routes.map((route) => Object.freeze({ ...route, domain: host })),
      this.adHoc.map((route) => Object.freeze({ ...route, domain: host })),
    );
  }

  /**
   * Registers every route on Hono and returns the registry entries: the contract routes, then the ad-hoc ones. Hono
   * matches in registration order, so routes are registered by specificity (`registrationOrder`), not in tree order.
   */
  mount(app: Hono): (RouteEntry | AdHocRouteEntry)[] {
    warnUnenforced(this.routes);
    // Every handler is built (and its throttle checked) before the first one is registered: no half-mounted app
    const handlers = registrationOrder<RouteEntry | AdHocRouteEntry>([...this.routes, ...this.adHoc]).map((route) => {
      const kernel = RequestKernel.handle(routeParams(route));
      // The contract's rate limit runs before the route middleware, with no middleware of its own (#229). An ad-hoc
      // route has no contract, so it has no throttle either.
      const handle = route.controller !== undefined && route.throttle ? throttled(route, route.throttle, kernel) : kernel;
      const domain = route.domain;
      return [route, domain === undefined ? handle : async (c: Context, next: Next) => (hostname(c) === domain ? handle(c, next) : next())] as const;
    });
    for (const [route, handle] of handlers) app.on(route.method.toUpperCase(), route.path, handle);
    return [...this.routes, ...this.adHoc];
  }
}

/**
 * `Route.api(appApi, (r) => [...])` (docs/v1/http.md › Router v2): mounts the contracts of the folder tree.
 * Their URLs come from the tree, so there is no route prefix. A missing or duplicate contract, and a scope with
 * `authorize` and no policy, are compile errors and runtime errors.
 */
export function api<A extends { readonly [API_ROOT]: true }, const M extends readonly ApiRouteItem[]>(
  appApi: A,
  routes: (r: ApiRouteBuilder<A>) => M & CheckApiRoutes<A, M>,
): ApiRoutes {
  if (typeof routes !== "function") fail("expected a routes callback: Route.api(appApi, (r) => [...])");
  const entries = treeEntries(appApi);
  const { routes: planned, adHoc } = plan(appApi, entries, routes(new RouteBuilder([], entries) as unknown as ApiRouteBuilder<A>));
  return new ApiRoutes(planned, adHoc);
}
