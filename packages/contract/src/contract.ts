import { Endpoint } from "./endpoint";
import type { AnyEndpoint } from "./endpoint";

/** Brand carrying a contract's name. Non-enumerable, so it never shows up in keys, spreads or JSON. */
export const CONTRACT_NAME: unique symbol = Symbol.for("laratype.contract");

export type ContractDef = Record<string, AnyEndpoint>;

/** A named group of endpoints: `defineContract("users", { index, show })`. */
export type Contract<N extends string = string, D extends ContractDef = ContractDef> = Readonly<D> & { readonly [CONTRACT_NAME]: N };

export type AnyContract = Contract<string, any>;

/** Endpoint keys of a contract, without the brand: `"index" | "show"`. */
export type EndpointKeys<C> = Exclude<keyof C, typeof CONTRACT_NAME> & string;

/** The literal name a contract was defined with. */
export type ContractName<C> = C extends { readonly [CONTRACT_NAME]: infer N extends string } ? N : never;

/** Route registry names of one contract: `"users.index" | "users.show"`. */
export type ContractRouteName<C> = C extends AnyContract ? `${ContractName<C>}.${EndpointKeys<C>}` : never;

const fail = (message: string): never => {
  throw new TypeError(`[@laratype/contract] ${message}`);
};

/**
 * Groups endpoints under a name. The name prefixes every route registry name (`users.show`),
 * so it must be non-empty, and endpoint keys must not contain ".".
 */
export function defineContract<const N extends string, const D extends ContractDef>(name: N, endpoints: D): Contract<N, D> {
  if (typeof name !== "string" || name === "" || name.split(".").some((s) => s === "")) {
    fail(`defineContract: invalid contract name ${JSON.stringify(name)}`);
  }
  const contract = Object.create(null) as Record<string | symbol, unknown>;
  for (const [key, value] of Object.entries(endpoints)) {
    if (key.includes(".")) fail(`defineContract("${name}"): endpoint key "${key}" must not contain "."`);
    if (!(value instanceof Endpoint)) fail(`defineContract("${name}"): "${key}" is not an endpoint`);
    contract[key] = value;
  }
  Object.defineProperty(contract, CONTRACT_NAME, { value: name, enumerable: false });
  return Object.freeze(contract) as Contract<N, D>;
}

export const isContract = (value: unknown): value is AnyContract =>
  typeof value === "object" && value !== null && typeof (value as Record<symbol, unknown>)[CONTRACT_NAME] === "string";

export const contractName = <C extends AnyContract>(contract: C): ContractName<C> => contract[CONTRACT_NAME] as ContractName<C>;

/** `routeName(users, "show")` → `"users.show"`: the route registry naming convention. */
export const routeName = <C extends AnyContract, K extends EndpointKeys<C>>(contract: C, key: K): `${ContractName<C>}.${K}` =>
  `${contractName(contract)}.${key}`;

/** `[key, endpoint]` pairs in definition order. */
export const contractEndpoints = <C extends AnyContract>(contract: C): Array<[EndpointKeys<C>, AnyEndpoint]> =>
  Object.entries(contract) as Array<[EndpointKeys<C>, AnyEndpoint]>;

// ---- defineApi --------------------------------------------------------------

export type ApiDef = Record<string, AnyContract>;

/** Each key must be the contract's own name, so `api.users.show` and the registry name `users.show` agree. */
export type CheckApi<A> = {
  [K in keyof A]: A[K] extends AnyContract
    ? ContractName<A[K]> extends K
      ? A[K]
      : { error: `defineApi: key "${K & string}" must match the contract name "${ContractName<A[K]>}"` }
    : { error: `defineApi: "${K & string}" is not a contract (use defineContract)` };
};

/** The FE-facing API: contracts only, never routes, controllers or server code. */
export type Api<A extends ApiDef = ApiDef> = Readonly<A>;

/** Every route registry name in an API: `"users.index" | "users.show" | "posts.index" | ...`. */
export type ApiRouteName<A> = { [K in keyof A]: ContractRouteName<A[K]> }[keyof A];

/** The endpoint behind a registry name: `ApiEndpoint<AppApi, "users.show">` (contract names may contain "."). */
export type ApiEndpoint<A, Name extends string> = {
  [C in keyof A]: { [K in EndpointKeys<A[C]>]: `${C & string}.${K}` extends Name ? A[C][K] : never }[EndpointKeys<A[C]>];
}[keyof A];

/**
 * The single FE entry point (`app/contracts/index.ts`): `export const appApi = defineApi({ users, posts })`.
 * The FE imports this module only, never `typeof routes`, so its type-check never loads server code.
 */
export function defineApi<const A extends ApiDef>(contracts: A & CheckApi<A>): Api<A> {
  const api = Object.create(null) as Record<string, AnyContract>;
  for (const [key, contract] of Object.entries(contracts as A)) {
    if (!isContract(contract)) fail(`defineApi: "${key}" is not a contract (use defineContract)`);
    if (contract[CONTRACT_NAME] !== key) fail(`defineApi: key "${key}" must match the contract name "${contract[CONTRACT_NAME]}"`);
    api[key] = contract;
  }
  return Object.freeze(api) as Api<A>;
}

/** All `[registryName, endpoint]` pairs of an API, in definition order. Used by the router, the client and typegen. */
export const apiRoutes = <A extends ApiDef>(api: Api<A>): Array<[ApiRouteName<A>, AnyEndpoint]> =>
  Object.values(api).flatMap((c) => contractEndpoints(c).map(([k, e]) => [routeName(c, k), e] as [ApiRouteName<A>, AnyEndpoint]));

/** `apiEndpoint(appApi, "users.show")` → the `users.show` endpoint (throws on an unknown name). */
export function apiEndpoint<A extends ApiDef, Name extends ApiRouteName<A>>(api: Api<A>, name: Name): ApiEndpoint<A, Name> {
  const dot = name.lastIndexOf("."); // endpoint keys never contain "."
  const contract = (api as ApiDef)[name.slice(0, dot)];
  const endpoint = contract && (contract as Record<string, unknown>)[name.slice(dot + 1)];
  if (!(endpoint instanceof Endpoint)) fail(`apiEndpoint: unknown route name "${name}"`);
  return endpoint as ApiEndpoint<A, Name>;
}
