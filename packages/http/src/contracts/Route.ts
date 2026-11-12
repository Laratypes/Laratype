import type { Ability, Policy } from "@laratype/auth";
import type { AnyEndpoint } from "@laratype/contract";
import type { Newable } from "@laratype/core";
import Controller from "../controller/Controller"
import type { MiddlewareClass } from "../routing/api/types";
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
  request?: typeof Request,
  can?: PolicyFactory[],
  /** Any class the container can construct: `app.make()` injects its constructor params (H2 #105). */
  controller: [Newable<object>, string]
  middleware?: Array<MiddlewareClass>,
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
