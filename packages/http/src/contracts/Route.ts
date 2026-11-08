import type { Ability, Policy } from "@laratype/auth";
import type { AnyEndpoint } from "@laratype/contract";
import type { Newable } from "@laratype/core";
import Controller from "../controller/Controller"
import Middleware from "../middleware/Middleware"
import type { MiddlewareItem } from "../middleware/defineMiddleware"
import type { Binder } from "../routing/api/proof"
import Request from "../supports/Request";
import type { METHOD } from "./Request";

export { };

export type PolicyFactory = {
  ability: Ability,
  args: any[],
  modelPolicy: any,
  handle: (ability: Ability, policy: new () => Policy, ...args: any[]) => Promise<boolean>
}

export type RouteOptions = ({
  middleware?: Array<typeof Middleware>,
  withoutMiddleware?: Array<typeof Middleware>,
  children: Array<RouteOptions>,
  method?: METHOD,
  controller?: [typeof Controller, string],
} | {
  method: METHOD,
  children?: Array<RouteOptions>,
  controller: [typeof Controller, string],
}) & {
  path: string,
  middleware?: Array<typeof Middleware>,
  withoutMiddleware?: Array<typeof Middleware>,
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
  request?: typeof Request,
  can?: PolicyFactory[],
  /** Any class the container can construct: `app.make()` injects its constructor params (H2 #105). */
  controller: [Newable<object>, string]
  /** 0.5 `Middleware` classes, or the `defineMiddleware()` values of a `Route.api` route (H6 #117). */
  middleware?: Array<MiddlewareItem>,
  /** The `r.bind()` bindings of a `Route.api` route, resolved once per request before policies (H7 #118). */
  bindings?: Readonly<Record<string, Binder>>,
  withoutMiddleware?: Array<typeof Middleware>,
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
