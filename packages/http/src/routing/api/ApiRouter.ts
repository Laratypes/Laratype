import type { Context, Hono, Next } from "hono";
import { API_NODE, apiRoutes, isEndpoint } from "@laratype/contract";
import type { AnyContract, Api, ApiEntry, ApiNodeInfo, ApiRoute } from "@laratype/contract";
import Controller from "../../controller/Controller";
import RequestKernel from "../../request/Request";
import type { RouteParams } from "../../contracts/Route";
import type {
  ApiRouteBuilder,
  ApiRouteItem,
  CheckApiRoutes,
  ControllerClass,
  MiddlewareClass,
  MountedContract,
  MountedScope,
  RouteEntry,
  ScopeRouteOptions,
  UnenforcedCap,
} from "./types";
import { UNENFORCED_NOTICE } from "./types";

const fail = (message: string): never => {
  throw new Error(`[@laratype/http] Route.api: ${message}`);
};

/** Runtime `r`; its types come from `ApiRouteBuilder<A>`. */
class RouteBuilder {
  constructor(private readonly stack: readonly MiddlewareClass[] = []) {}

  middleware(...middleware: MiddlewareClass[]) {
    return new RouteBuilder([...this.stack, ...middleware]);
  }

  contract(contract: AnyContract, controller: ControllerClass): MountedContract {
    return Object.freeze({ kind: "contract", contract, controller, middleware: this.stack });
  }

  scope(dir: string, options: ScopeRouteOptions): MountedScope {
    if (typeof options?.policy !== "function") fail(`r.scope('${dir}') needs { policy }`);
    return Object.freeze({ kind: "scope", dir, policy: options.policy, middleware: this.stack });
  }
}

interface TreeEntry {
  readonly name: string;
  readonly entry: ApiEntry;
}

const nodeInfo = (value: unknown) =>
  typeof value === "object" && value !== null ? (value as Record<symbol, ApiNodeInfo | undefined>)[API_NODE] : undefined;

/**
 * The mounted contracts of an API tree with their `dirs`, depth-first: `apiRoutes()` gives the routes but not the
 * entries. Endpoints are told by the `isEndpoint` brand; every other child must be a node, and the root holds nodes
 * only, so a value that is not a `defineApi` tree throws.
 */
const treeEntries = (api: unknown): TreeEntry[] => {
  if (typeof api !== "object" || api === null) fail("expected the appApi tree built with defineApi");
  if (Object.values(api as object).some((child) => !nodeInfo(child))) fail("expected the appApi tree built with defineApi");
  const out: TreeEntry[] = [];
  const walk = (node: object) => {
    for (const child of Object.values(node)) {
      if (isEndpoint(child)) continue;
      const info = nodeInfo(child);
      if (!info) return fail("expected the appApi tree built with defineApi");
      if (info.entry) out.push({ name: info.name, entry: info.entry as ApiEntry });
      walk(child as object);
    }
  };
  walk(api as object);
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

/** The request hostname, without the port (dev Host headers carry `:3000`) and one trailing dot (`api.example.com.`). */
const hostname = (c: Context) => new URL(c.req.url).hostname.toLowerCase().replace(/\.$/, "");

/**
 * Builds the routes of `Route.api(appApi, (r) => [...])` and checks them at runtime as the types do:
 * every contract of the tree is mounted once, every `r.scope()` names a scope folder, and every scope with
 * `authorize` has a policy.
 */
const plan = (api: unknown, items: readonly ApiRouteItem[]): RouteEntry[] => {
  const entries = treeEntries(api);
  if (!Array.isArray(items)) fail("the routes callback must return an array of r.contract() and r.scope()");

  const scopeDirs = new Map<string, boolean>();
  for (const { entry } of entries) entry.scopes.forEach((scope, i) => scopeDirs.set(entry.dirs[i]!, scope.authorize === true || scopeDirs.get(entry.dirs[i]!) === true));

  const scopes = new Map<string, MountedScope>();
  const contracts = new Map<AnyContract, MountedContract>();
  for (const item of items) {
    if (item?.kind === "scope") {
      if (!scopeDirs.has(item.dir)) fail(`"${item.dir}" is not a scope folder of the API tree (folders: ${[...scopeDirs.keys()].map((d) => `"${d}"`).join(", ") || "none"})`);
      if (scopes.has(item.dir)) fail(`scope "${item.dir}" is mounted twice`);
      scopes.set(item.dir, item);
    } else if (item?.kind === "contract") {
      const names = entries.filter((e) => e.entry.contract === item.contract).map((e) => e.name);
      if (names.length === 0) fail("a mounted contract is not in the API tree");
      if (typeof item.controller !== "function") {
        fail(`contract "${names.join('", "')}": r.contract() got ${String(item.controller)} as its controller (a circular import?)`);
      }
      if (contracts.has(item.contract)) fail(`contract "${names.join('", "')}" is mounted twice`);
      contracts.set(item.contract, item);
    } else {
      fail("the routes callback must return r.contract() and r.scope() items");
    }
  }

  const missing = entries.filter((e) => !contracts.has(e.entry.contract)).map((e) => e.name);
  if (missing.length) fail(`contract "${missing.join('", "')}" is not mounted (add r.contract())`);
  for (const [dir, authorize] of scopeDirs) {
    if (authorize && !scopes.has(dir)) fail(`scope "${dir}" has authorize but no policy (add r.scope('${dir}', { policy }))`);
  }

  const byName = new Map(entries.map((e) => [e.name, e.entry]));
  return (apiRoutes(api as Api) as ApiRoute[]).map((route): RouteEntry => {
    const key = route.name.slice(route.name.lastIndexOf(".") + 1);
    const entry = byName.get(route.name.slice(0, route.name.lastIndexOf(".")))!;
    const mounted = contracts.get(entry.contract)!;
    if (!isHandler(mounted.controller, key)) {
      fail(`${route.name}: ${mounted.controller.name} has no method "${key}" (handlers must be class methods, not arrow-function fields)`);
    }
    const scopeItems = entry.dirs.map((dir) => scopes.get(dir)).filter((s): s is MountedScope => s !== undefined);
    return Object.freeze({
      ...route,
      controller: Object.freeze([mounted.controller, key] as const),
      // One builder can mount a scope and a contract: each middleware runs once, at its first position
      middleware: Object.freeze([...new Set([...scopeItems.flatMap((s) => s.middleware), ...mounted.middleware])]),
      policies: Object.freeze(scopeItems.map((s) => Object.freeze({ dir: s.dir, policy: s.policy }))),
      unenforced: unenforcedCaps(route),
      domain: undefined,
    });
  });
};

/**
 * What the router does not enforce yet for a route: its resolved `auth` / `authorize` (#105, #121), its `throttle`
 * (#229) and the
 * validation of its body, query and headers schemas (#106). The one place that decides it: the mount warning and
 * `sauf route:list` both read `RouteEntry.unenforced`.
 */
const unenforcedCaps = (route: ApiRoute): readonly UnenforcedCap[] => {
  const { query, body, headers } = route.endpoint.def;
  return Object.freeze([
    ...(route.auth ? (["auth"] as const) : []),
    ...(route.authorize ? (["authorize"] as const) : []),
    ...(route.throttle ? (["throttle"] as const) : []),
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

/** One warning per mount: until #105 / #121 / #229 / #106 such a route skips those checks. */
const warnUnenforced = (routes: readonly RouteEntry[]) => {
  const list = routes.filter((route) => route.unenforced.length).map((route) => `${route.name} (${route.unenforced.join(", ")})`);
  if (list.length === 0) return;
  console.warn(`[@laratype/http] Route.api: ${UNENFORCED_NOTICE}, so these routes skip those checks: ${list.join(", ")}`);
};

/** The routes of one `Route.api(...)`, checked and ready to mount. */
export class ApiRoutes {
  /** One entry per route, depth-first in tree order. */
  public readonly routes: readonly RouteEntry[];

  /** Built by `Route.api()` only: `@laratype/http` exports the type, not the constructor. */
  constructor(routes: readonly RouteEntry[]) {
    this.routes = Object.freeze([...routes]);
  }

  /** Serves these routes on `domain` only (the request port is ignored). Other hosts fall through to the next route. */
  domain(domain: string): ApiRoutes {
    const host = checkDomain(domain);
    return new ApiRoutes(this.routes.map((route) => Object.freeze({ ...route, domain: host })));
  }

  /** Registers every route on Hono and returns the registry entries. */
  mount(app: Hono): RouteEntry[] {
    warnUnenforced(this.routes);
    for (const route of this.routes) {
      const handle = RequestKernel.handle({
        method: route.method,
        path: route.path,
        name: route.name,
        status: route.endpoint.def.status,
        controller: route.controller as unknown as RouteParams["controller"],
        middleware: [...route.middleware],
      });
      const domain = route.domain;
      app.on(
        route.method.toUpperCase(),
        route.path,
        domain === undefined ? handle : async (c: Context, next: Next) => (hostname(c) === domain ? handle(c) : next()),
      );
    }
    return [...this.routes];
  }
}

/**
 * `Route.api(appApi, (r) => [...])` (docs/v1/http.md › Router v2): mounts the contracts of the folder tree.
 * Their URLs come from the tree, so there is no route prefix. A missing or duplicate contract, and a scope with
 * `authorize` and no policy, are compile errors and runtime errors.
 */
export function api<A extends object, const M extends readonly ApiRouteItem[]>(
  appApi: A,
  routes: (r: ApiRouteBuilder<A>) => M & CheckApiRoutes<A, M>,
): ApiRoutes {
  if (typeof routes !== "function") fail("expected a routes callback: Route.api(appApi, (r) => [...])");
  return new ApiRoutes(plan(appApi, routes(new RouteBuilder() as unknown as ApiRouteBuilder<A>)));
}
