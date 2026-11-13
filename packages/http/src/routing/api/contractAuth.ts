import type { AnyTypedMiddleware } from "../../middleware/defineMiddleware";

/**
 * The slot where `@laratype/auth` registers the factory of a route's contract auth middleware (A2 #120). A
 * `Symbol.for` key on `globalThis`, so the auth package and the router agree across two copies of @laratype/http.
 */
const CONTRACT_AUTH: unique symbol = Symbol.for("laratype.http.contractAuth");

/**
 * The marker `@laratype/auth` sets on the factory it registers (A2 #120). A second copy of the package, or a reload
 * of the module, builds another closure, so a branded factory replaces a branded one. It is not a security boundary:
 * any in-process code can set it; it only tells a second copy of @laratype/auth from an unrelated value.
 */
const CONTRACT_AUTH_BRAND: unique symbol = Symbol.for("laratype.auth.contractAuthFactory");

/**
 * Builds the typed middleware that enforces a route's resolved `auth` (`true` is the default guard). `@laratype/auth`
 * registers it on import; `Route.api` calls it at `mount()`.
 */
export type ContractAuthFactory = (guard: true | string) => AnyTypedMiddleware;

type Slot = { [CONTRACT_AUTH]?: unknown };

const isBranded = (value: unknown): boolean =>
  typeof value === "function" && (value as { [CONTRACT_AUTH_BRAND]?: unknown })[CONTRACT_AUTH_BRAND] === true;

/**
 * Fills the contract auth slot. `@laratype/auth` calls it once on import with its branded factory. The same function
 * twice is fine. A branded factory replaces a branded one (last wins), so a reloaded module or a second copy of the
 * package (each builds a new closure, both resolving the same guards through the container) does not throw. The brand
 * is not a security boundary: any in-process code can set it; it only tells a second copy of @laratype/auth from an
 * unrelated value. Any other different function throws, so auth never silently overwrites a different value. A
 * non-function value is replaced: `contractAuth()` treats it as "not imported", so it is not a registered factory.
 */
export function registerContractAuth(factory: ContractAuthFactory): void {
  const slot = globalThis as Slot;
  const existing = slot[CONTRACT_AUTH];
  if (existing === undefined || existing === factory) {
    slot[CONTRACT_AUTH] = factory;
    return;
  }
  if (isBranded(existing) && isBranded(factory)) {
    slot[CONTRACT_AUTH] = factory;
    return;
  }
  if (typeof existing !== "function") {
    slot[CONTRACT_AUTH] = factory;
    return;
  }
  const found = existing.name || "an anonymous function";
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
