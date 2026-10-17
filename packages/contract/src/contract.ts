import { SCOPE, checkOptions, joinPath, resolveCapabilities } from "./capabilities";
import type {
  AnyPrefix,
  AnyScope,
  AuthOption,
  CapabilityProblem,
  ContractOptions,
  ContractPrefix,
  EndpointContext,
  PrefixPath,
  PrefixScopes,
  ResolvedCapabilities,
  RootContext,
  Scope,
  ScopeOptions,
} from "./capabilities";
import { isEndpoint } from "./endpoint";
import type { AnyEndpoint, Method } from "./endpoint";

/** Brand of a contract: holds its options. Non-enumerable, so it never shows up in keys, spreads or JSON. */
export const CONTRACT: unique symbol = Symbol.for("laratype.contract");

export type ContractDef = Record<string, AnyEndpoint>;

export interface ContractMeta<P extends AnyPrefix = AnyPrefix, O extends ContractOptions = ContractOptions> {
  readonly options: O;
  /** phantom: the folder context (`Prefix`), type-only */
  readonly prefix?: P;
}

/** A group of endpoints from one file of the contract folder tree. Its name and URL prefix come from the tree. */
export type Contract<P extends AnyPrefix = AnyPrefix, D extends ContractDef = ContractDef, O extends ContractOptions = ContractOptions> =
  Readonly<D> & { readonly [CONTRACT]: ContractMeta<P, O> };

export type AnyContract = Contract<any, any, any>;

/** Endpoint keys of a contract, without the brand: `"index" | "show"`. */
export type EndpointKeys<C> = Exclude<keyof C, typeof CONTRACT> & string;

export type ContractPrefixOf<C> = C extends { readonly [CONTRACT]: ContractMeta<infer P, any> } ? P : never;
export type ContractOptionsOf<C> = C extends { readonly [CONTRACT]: ContractMeta<any, infer O> } ? O : never;

/** The context of a contract's endpoints in its own file: folder path, scope chain, contract options. */
export type ContractContext<P extends AnyPrefix, O extends ContractOptions> = { path: PrefixPath<P>; scopes: PrefixScopes<P>; options: O };

/** Each endpoint must have consistent capabilities, e.g. no `.public()` under a scope with `authorize`. */
export type CheckEndpoints<D, Ctx extends EndpointContext> = {
  [K in keyof D]: D[K] extends AnyEndpoint
    ? [CapabilityProblem<D[K], Ctx>] extends [never]
      ? D[K]
      : { error: `${K & string}: ${CapabilityProblem<D[K], Ctx>}` }
    : D[K];
};

type HasAuth<S extends readonly unknown[]> = true extends { [I in keyof S]: S[I] extends { readonly auth: AuthOption } ? true : false }[number] ? true : false;

/** A scope's `authorize` needs `auth` at the same level or an outer one. */
export type CheckScope<P extends AnyPrefix, O> = O extends { readonly authorize: true }
  ? HasAuth<[...PrefixScopes<P>, O]> extends true
    ? unknown
    : { error: "defineScope: authorize needs auth in this scope or an outer one" }
  : unknown;

const fail = (message: string): never => {
  throw new TypeError(`[@laratype/contract] ${message}`);
};

function buildContract(endpoints: ContractDef, options: ContractOptions): AnyContract {
  if (typeof endpoints !== "object" || endpoints === null) fail("defineContract: endpoints must be an object");
  const contract = Object.create(null) as Record<string | symbol, unknown>;
  for (const [key, value] of Object.entries(endpoints)) {
    if (key === "" || key.includes(".")) fail(`defineContract: endpoint key "${key}" must be non-empty and must not contain "."`);
    if (!isEndpoint(value)) fail(`defineContract: "${key}" is not an endpoint`);
    contract[key] = value;
  }
  const meta = Object.freeze({ options: Object.freeze(checkOptions(options, ["auth", "throws", "throttle"], "defineContract")) });
  Object.defineProperty(contract, CONTRACT, { value: meta, enumerable: false });
  return Object.freeze(contract) as AnyContract;
}

function buildScope(options: ScopeOptions): AnyScope {
  const scope = checkOptions(options, ["auth", "authorize", "throws", "throttle"], "defineScope") as Record<string | symbol, unknown>;
  Object.defineProperty(scope, SCOPE, { value: true, enumerable: false });
  return Object.freeze(scope) as AnyScope;
}

/**
 * A contract file of the folder tree. `Prefix` comes from the generated `./$types` and types the folder
 * params and the inherited scopes; the options are the contract level of the capabilities.
 *
 * @example
 * import type { Prefix } from './$types'
 * export default defineContract<Prefix>()({ index: endpoint.get('/'), update: endpoint.patch('/:post') }, { auth: true })
 */
export const defineContract =
  <P extends AnyPrefix = ContractPrefix>() =>
  <const D extends ContractDef, const O extends ContractOptions = {}>(
    endpoints: D & CheckEndpoints<D, ContractContext<P, O>>,
    options?: O,
  ): Contract<P, D, O> =>
    buildContract(endpoints, options ?? {}) as Contract<P, D, O>;

/**
 * A folder scope (`_scope.ts`): capabilities inherited by every contract in the folder and its subfolders.
 * `ScopePrefix` (from `./$types`) holds the outer scopes only.
 */
export const defineScope =
  <P extends AnyPrefix = ContractPrefix>() =>
  <const O extends ScopeOptions>(options: O & CheckScope<P, O>): Scope<O> =>
    buildScope(options) as Scope<O>;

export const isContract = (value: unknown): value is AnyContract =>
  typeof value === "object" && value !== null && typeof (value as Record<symbol, unknown>)[CONTRACT] === "object";

export const isScope = (value: unknown): value is AnyScope =>
  typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[SCOPE] === true;

/** `[key, endpoint]` pairs in definition order. */
export const contractEndpoints = <C extends AnyContract>(contract: C): Array<[EndpointKeys<C>, AnyEndpoint]> =>
  Object.entries(contract) as Array<[EndpointKeys<C>, AnyEndpoint]>;

// ---- defineApi --------------------------------------------------------------

/** Brand of each API tree node, holding its tree name and its entry (none for a pure folder). */
export const API_NODE: unique symbol = Symbol.for("laratype.api");

/** One contract of the folder tree, as the generated `.laratype/api/index.gen.ts` mounts it. */
export interface ApiEntry<C extends AnyContract = AnyContract, Path extends string = string, S extends readonly AnyScope[] = readonly AnyScope[]> {
  readonly contract: C;
  /** Full URL prefix, file segment included: `/api/users/:user/posts`. */
  readonly path: Path;
  /** The `_scope.ts` chain, outer to inner. */
  readonly scopes: S;
}

/** Flat map keyed by tree name: `{ 'users': {...}, 'users.posts': {...} }`. */
export type ApiDef = Record<string, ApiEntry>;

export interface ApiNodeInfo<N extends string = string, En = ApiEntry | undefined> {
  readonly name: N;
  readonly entry: En;
}

type BadName<K extends string> = K extends "" | `.${string}` | `${string}.` | `${string}..${string}` ? true : false;

/** Per key: the entry, or `{ error }` (bad name, path outside the folder prefix, endpoint/child name clash). */
export type CheckApi<A> = {
  [K in keyof A]: K extends string
    ? BadName<K> extends true
      ? { error: `defineApi: invalid tree name "${K}"` }
      : A[K] extends ApiEntry<infer C, infer Path, any>
        ? Path extends `${PrefixPath<ContractPrefixOf<C>>}${string}`
          ? [Extract<keyof A, `${K}.${EndpointKeys<C>}` | `${K}.${EndpointKeys<C>}.${string}`>] extends [never]
            ? A[K]
            : { error: `defineApi: "${K}" has an endpoint and a child contract with the same name` }
          : { error: `defineApi: "${K}" path must start with its folder prefix "${PrefixPath<ContractPrefixOf<C>>}"` }
        : { error: `defineApi: "${K}" must be { contract, path, scopes }` }
    : A[K];
};

type Head<K> = K extends `${infer H}.${string}` ? H : K;
type Sub<A, H extends string> = { [K in keyof A & string as K extends `${H}.${infer T}` ? T : never]: A[K] };
type EntryAt<A, H> = H extends keyof A ? A[H] : undefined;
type EndpointsOf<En> = En extends { readonly contract: infer C } ? { readonly [K in EndpointKeys<C>]: C[K & keyof C] } : {};

type Tree<A, Base extends string> = { readonly [H in Head<keyof A & string>]: ApiNode<A, H, `${Base}${H}`> };

/** One node of the API tree: the endpoints of its contract, its child nodes and the brand. */
export type ApiNode<A, H extends string, Name extends string> = EndpointsOf<EntryAt<A, H>> &
  Tree<Sub<A, H>, `${Name}.`> & { readonly [API_NODE]: ApiNodeInfo<Name, EntryAt<A, H>> };

/** The nested API tree built from the flat entries: `appApi.users.posts.update`. */
export type Api<A extends ApiDef = ApiDef> = Tree<A, "">;

type NodeName<N> = N extends { readonly [API_NODE]: ApiNodeInfo<infer Name, any> } ? Name : never;

/** Every route name in an API tree: `"users.index" | "users.posts.update" | ...`. */
export type ApiRouteName<A> = {
  [K in keyof A & string]: A[K] extends AnyEndpoint ? `${NodeName<A>}.${K}` : ApiRouteName<A[K]>;
}[keyof A & string];

/** The endpoint behind a route name: `ApiEndpoint<AppApi, "users.posts.update">`. */
export type ApiEndpoint<A, Name extends string> = Name extends keyof A
  ? A[Name] extends AnyEndpoint ? A[Name] : never
  : Name extends `${infer H}.${infer T}`
    ? H extends keyof A ? ApiEndpoint<A[H], T> : never
    : never;

/** The context of a mounted endpoint: the full URL prefix, the scope chain and the contract options. */
export type EntryContext<En> = En extends ApiEntry<infer C, infer Path, any>
  ? { path: Path; scopes: PrefixScopes<ContractPrefixOf<C>>; options: ContractOptionsOf<C> }
  : RootContext;

export type NodeContext<N> = N extends { readonly [API_NODE]: ApiNodeInfo<any, infer En> } ? EntryContext<En> : RootContext;

type TreeNode = Record<string | symbol, unknown>;

/**
 * Builds the API tree from the flat entries that `.laratype/api/index.gen.ts` emits:
 * `defineApi({ 'users.posts': { contract, path: '/api/users/:user/posts', scopes: [usersUser] } })`.
 * The FE imports this module only, never `typeof routes`, so its type-check never loads server code.
 */
export function defineApi<const A extends ApiDef>(entries: A & CheckApi<A>): Api<A> {
  const root: TreeNode = Object.create(null);
  const infos = new Map<TreeNode, { name: string; entry: ApiEntry | undefined }>();

  const nodeAt = (name: string): TreeNode => {
    let node = root;
    let path = "";
    for (const segment of name.split(".")) {
      path = path ? `${path}.${segment}` : segment;
      const next = node[segment];
      if (isEndpoint(next)) fail(`defineApi: "${path}" is both an endpoint and a contract`);
      if (next === undefined) {
        const child: TreeNode = Object.create(null);
        infos.set(child, { name: path, entry: undefined });
        node[segment] = child;
      }
      node = node[segment] as TreeNode;
    }
    return node;
  };

  for (const [name, entry] of Object.entries(entries as ApiDef)) {
    if (name.split(".").some((s) => s === "")) fail(`defineApi: invalid tree name "${name}"`);
    if (typeof entry !== "object" || entry === null || !isContract(entry.contract)) fail(`defineApi: "${name}" must be { contract, path, scopes }`);
    if (typeof entry.path !== "string" || !entry.path.startsWith("/")) fail(`defineApi: "${name}" path must start with "/"`);
    if (!Array.isArray(entry.scopes) || !entry.scopes.every(isScope)) fail(`defineApi: "${name}" scopes must be scopes (use defineScope)`);
    entry.scopes.forEach((scope, i) => {
      if (scope.authorize === true && !entry.scopes.slice(0, i + 1).some((s) => s.auth)) {
        fail(`defineApi: "${name}": scope ${i} has authorize but no auth in it or an outer scope`);
      }
    });
    const node = nodeAt(name);
    infos.get(node)!.entry = Object.freeze({ contract: entry.contract, path: entry.path, scopes: Object.freeze([...entry.scopes]) });
    for (const [key, endpoint] of contractEndpoints(entry.contract)) {
      if (node[key] !== undefined) fail(`defineApi: "${name}.${key}" is both an endpoint and a contract`);
      node[key] = endpoint;
      resolveCapabilities(endpoint.def, contextOf(infos.get(node)!.entry!), `${name}.${key}`);
    }
  }

  for (const [node, info] of infos) {
    Object.defineProperty(node, API_NODE, { value: Object.freeze(info), enumerable: false });
    Object.freeze(node);
  }
  return Object.freeze(root) as Api<A>;
}

const contextOf = (entry: ApiEntry) => ({ path: entry.path, scopes: entry.scopes, options: entry.contract[CONTRACT].options });

/** One route of an API without its capabilities: tree name, method, full path and where it sits. */
export interface ApiPath<N extends string = string> {
  readonly name: N;
  readonly method: Method;
  /** Full path: the contract's URL prefix joined with the endpoint path. */
  readonly path: string;
  readonly endpoint: AnyEndpoint;
  readonly contract: AnyContract;
  readonly scopes: readonly AnyScope[];
}

/** One resolved route of an API: tree name, full path, the endpoint and its inherited capabilities. */
export interface ApiRoute<N extends string = string> extends ResolvedCapabilities {
  readonly name: N;
  readonly method: Method;
  /** Full path: the contract's URL prefix joined with the endpoint path. */
  readonly path: string;
  readonly endpoint: AnyEndpoint;
  readonly contract: AnyContract;
  readonly scopes: readonly AnyScope[];
}

/** The one walk over an API: each route with the context it is mounted in (the contract's URL prefix, scopes, options). */
function walkRoutes(api: object, visit: (name: string, endpoint: AnyEndpoint, contract: AnyContract, ctx: ReturnType<typeof contextOf>) => void): void {
  if (isContract(api)) {
    const ctx = { path: "", scopes: [] as readonly AnyScope[], options: api[CONTRACT].options };
    for (const [key, endpoint] of contractEndpoints(api)) visit(key, endpoint, api, ctx);
    return;
  }
  const walk = (current: TreeNode) => {
    const info = current[API_NODE] as ApiNodeInfo | undefined;
    for (const [key, value] of Object.entries(current)) {
      if (!isEndpoint(value)) {
        walk(value as TreeNode);
        continue;
      }
      const entry = info!.entry!;
      visit(`${info!.name}.${key}`, value, entry.contract, contextOf(entry));
    }
  };
  walk(api as TreeNode);
}

const routeOf = (name: string, endpoint: AnyEndpoint, contract: AnyContract, ctx: ReturnType<typeof contextOf>): ApiPath => ({
  name,
  method: endpoint.def.method,
  path: joinPath(ctx.path, endpoint.def.path),
  endpoint,
  contract,
  scopes: ctx.scopes,
});

/**
 * Every route of an API with its name, method and full path, depth-first in definition order, without resolving
 * capabilities. It takes the API root, an API node (`appApi.users`, full names) or a single contract (endpoint keys,
 * its own paths). It walks the API the same way as `apiRoutes()`, so both give the same names and paths.
 */
export function apiPaths<C extends AnyContract>(contract: C): Array<ApiPath<EndpointKeys<C>>>;
export function apiPaths<A extends ApiDef>(api: Api<A>): Array<ApiPath<ApiRouteName<Api<A>>>>;
export function apiPaths(api: object): ApiPath[] {
  const paths: ApiPath[] = [];
  walkRoutes(api, (name, endpoint, contract, ctx) => paths.push(Object.freeze(routeOf(name, endpoint, contract, ctx))));
  return paths;
}

/**
 * Every route of an API, depth-first in definition order, with its inherited capabilities (the `apiPaths()` walk plus
 * `resolveCapabilities`). Used by the router and typegen. Takes the same inputs as `apiPaths()`; a single contract is
 * resolved with its own options only (no scopes).
 */
export function apiRoutes<C extends AnyContract>(contract: C): Array<ApiRoute<EndpointKeys<C>>>;
export function apiRoutes<A extends ApiDef>(api: Api<A>): Array<ApiRoute<ApiRouteName<Api<A>>>>;
export function apiRoutes(api: object): ApiRoute[] {
  const routes: ApiRoute[] = [];
  walkRoutes(api, (name, endpoint, contract, ctx) =>
    routes.push(Object.freeze({ ...routeOf(name, endpoint, contract, ctx), ...resolveCapabilities(endpoint.def, ctx, name) })),
  );
  return routes;
}

/** `apiEndpoint(appApi, "users.posts.update")` → that endpoint (throws on an unknown name). */
export function apiEndpoint<A extends ApiDef, Name extends ApiRouteName<Api<A>> & string>(api: Api<A>, name: Name): ApiEndpoint<Api<A>, Name> {
  let value: unknown = api;
  for (const segment of name.split(".")) {
    value = typeof value === "object" && value !== null && !isEndpoint(value) ? (value as TreeNode)[segment] : undefined;
  }
  if (!isEndpoint(value)) fail(`apiEndpoint: unknown route name "${name}"`);
  return value as ApiEndpoint<Api<A>, Name>;
}
