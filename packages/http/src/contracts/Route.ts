import type { Ability, Policy } from "@laratype/auth";
import type { AnyEndpoint } from "@laratype/contract";
import Controller from "../controller/Controller"
import Middleware from "../middleware/Middleware"
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
  /** The response status of a `Route.api` route, from its endpoint definition. */
  status?: number,
  /** `false` for `Route.api` routes: no 0.5 implicit or `Route.model` binding (contract binding is `r.bind`, H7 #118). */
  modelBinding?: false,
  /** The endpoint of a `Route.api` route, exposed to the handler as the read-only `ctx.endpoint` (#105). */
  endpoint?: AnyEndpoint,
  request?: typeof Request,
  can?: PolicyFactory[],
  controller: [typeof Controller, string]
  middleware?: Array<typeof Middleware>,
  withoutMiddleware?: Array<typeof Middleware>,
  name?: string,
  meta?: any,
}
