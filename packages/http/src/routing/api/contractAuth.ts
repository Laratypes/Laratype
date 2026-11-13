import type { AnyTypedMiddleware } from "../../middleware/defineMiddleware";

/**
 * The slot where `@laratype/auth` registers the factory of a route's contract auth middleware (A2 #120). A
 * `Symbol.for` key on `globalThis`, so the auth package and the router agree across two copies of @laratype/http.
 */
const CONTRACT_AUTH: unique symbol = Symbol.for("laratype.http.contractAuth");

/**
 * Builds the typed middleware that enforces a route's resolved `auth` (`true` is the default guard). `@laratype/auth`
 * registers it on import; `Route.api` calls it at `mount()`.
 */
export type ContractAuthFactory = (guard: true | string) => AnyTypedMiddleware;

type Slot = { [CONTRACT_AUTH]?: unknown };

/**
 * Fills the contract auth slot. `@laratype/auth` calls it once on import. Registering the same factory twice is fine
 * (two copies of the module); a different factory is refused, so the first one loaded keeps enforcing auth (A2 #120).
 */
export function registerContractAuth(factory: ContractAuthFactory): void {
  const slot = globalThis as Slot;
  const existing = slot[CONTRACT_AUTH];
  if (existing === undefined) {
    slot[CONTRACT_AUTH] = factory;
    return;
  }
  if (existing === factory) return;
  const found = typeof existing === "function" ? existing.name || "an anonymous function" : String(existing);
  throw new Error(
    `[@laratype/http] registerContractAuth(): the contract auth factory is already registered (${found}), so a second, different factory would replace it. Fix: import @laratype/auth once, or remove the other package that registers the slot.`,
  );
}

/**
 * The registered contract auth factory, or `undefined` when `@laratype/auth` was not imported (or the slot does not
 * hold a function: it is untrusted, so anything else is "not imported" and `Route.api` fails closed).
 */
export function contractAuth(): ContractAuthFactory | undefined {
  const value = (globalThis as Slot)[CONTRACT_AUTH];
  return typeof value === "function" ? (value as ContractAuthFactory) : undefined;
}
