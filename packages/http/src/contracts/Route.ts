import type { Ability, Policy } from "@laratype/auth";
import type { AnyEndpoint, AnyErrorDef } from "@laratype/contract";
import type { Newable } from "@laratype/core";
import Controller from "../controller/Controller"
import type { ContractPolicyChecks } from "../routing/api/contractPolicies"
import type { MiddlewareItem } from "../middleware/defineMiddleware"
import type { Bindings } from "../routing/api/proof"
import type { MiddlewareClass, PolicyClass } from "../routing/api/types";
import Request from "../supports/Request";
import type { METHOD } from "./Request";

export { };

export type PolicyFactory = {
  ability: Ability,
  args: any[],
  modelPolicy: any,
  /** The policy instance the request pipeline resolves from its container (H21 #269). */
  handle: (ability: Ability, policy: Policy, ...args: any[]) => Promise<boolean>
}

/**
 * @internal The contract policy chain `Route.api` hands to the kernel (H8 #122): the route's scope policies (outer to
 * inner), its endpoint policy and the endpoint key as the ability. `models` names the endpoint's own bound path params
 * in path order, the arguments the endpoint policy receives; a scope hook gets the whole resolved record instead.
 * `checks` are the slot functions read once at `mount()`, so a later slot change cannot turn enforcement off.
 */
interface RouteAuthorization {
  readonly ability: string,
  readonly scopes: readonly PolicyClass[],
  readonly policy: PolicyClass | undefined,
  readonly models: readonly string[],
  readonly checks: ContractPolicyChecks,
}

export type RouteOptions = ({
  middleware?: Array<MiddlewareClass>,
  withoutMiddleware?: Array<MiddlewareClass>,
  children: Array<RouteOptions>,
  method?: METHOD,
  controller?: [typeof Controller, string],
} | {
  method: METHOD,
  children?: Array<RouteOptions>,
  controller: [typeof Controller, string],
}) & {
  path: string,
  middleware?: Array<MiddlewareClass>,
  withoutMiddleware?: Array<MiddlewareClass>,
  request?: typeof Request,
  can?: PolicyFactory,
  name?: string,
  meta?: any,
}

export type RouteParams = {
  method: METHOD,
  path: string,
  /** `false` for `Route.api` routes: no 0.5 implicit or `Route.model` binding (contract binding is `r.bind`, H7 #118). */
  modelBinding?: false,
  /** The endpoint of a `Route.api` route, exposed to the handler as the read-only `ctx.endpoint` (#105). */
  endpoint?: AnyEndpoint,
  /**
   * @internal The errors the route's contract declares, derived ones included: `apiRoutes()`'s `errors` for the route,
   * which the dev and test undeclared-error check reads (docs/v1/http.md › Undeclared-error check, X3 #157).
   */
  errors?: readonly AnyErrorDef[],
  request?: typeof Request,
  can?: PolicyFactory[],
  /** Any class the container can construct: `app.make()` injects its constructor params (H2 #105). */
  controller: [Newable<object>, string]
  /** 0.5 `Middleware` classes, or the `defineMiddleware()` values of a `Route.api` route (H6 #117). */
  middleware?: Array<MiddlewareItem>,
  /** The `r.bind()` bindings of a `Route.api` route, resolved once per request before policies (H7 #118). */
  bindings?: Bindings,
  /** @internal The contract policy chain, built by `Route.api` for a route whose resolved `authorize` is true (H8 #122). */
  authorization?: RouteAuthorization,
  withoutMiddleware?: Array<MiddlewareClass>,
  name?: string,
  meta?: any,
}

/** An ad-hoc `Route.api` route (`r.get('/health', () => 'ok')`, H12 #139): it runs `handler` instead of a controller. */
export type AdHocRouteParams = Omit<RouteParams, "controller"> & {
  controller?: undefined,
  handler: (req: Request, params: Record<string, string>) => unknown,
}

/** What `RequestKernel` serves: a controller route, or an ad-hoc route. */
export type KernelRouteParams = RouteParams | AdHocRouteParams
