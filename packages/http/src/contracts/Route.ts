import type { Ability, Policy } from "@laratype/auth";
import Controller from "../controller/Controller"
import Middleware from "../middleware/Middleware"
import Request from "../supports/Request";
import { METHOD } from "./Request";

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
  controller?: [Controller, string],
} | {
  method: METHOD,
  children?: Array<RouteOptions>,
  controller: [Controller, string],
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
  request?: typeof Request,
  can?: PolicyFactory[],
  controller: [Controller, string]
  middleware?: Array<typeof Middleware>,
  withoutMiddleware?: Array<typeof Middleware>,
  name?: string,
  meta?: any,
}
