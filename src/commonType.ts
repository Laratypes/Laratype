import type {  Context, Handler } from "hono";
import type Middleware from "./middleware/Middleware";
import type ServiceProvider from "./support/ServiceProvider";
import type Request from "./request/Request";
import type Controller from "./controller/Controller";

export { };

export type METHOD = "get" | "post" | "patch" | "put" | "delete"

export type RouteOptions = ({
  middleware?: Array<Middleware>,
  children: Array<RouteOptions>,
  method?: METHOD,
  controller?: ReturnType<Controller['__invoke']>,
} | {
  method: METHOD,
  children?: Array<RouteOptions>,
  controller: ReturnType<Controller['__invoke']>,
}) & {
  path: string,
  middleware?: Array<Middleware>,
  request?: typeof Request,
  name?: string,
  meta?: any,
}

export type ConfigOptions = {
  providers: (typeof ServiceProvider)[]
}

export type safeMethods<T> = Exclude<keyof T, "exposed" | "__invoke">

export type ControllerMethod = (c: Context, req: Request) => ReturnType<Handler>

export interface IControllerMethod {
  exposed(): Array<safeMethods<this>>
}

export type ControllerParams = (c: Context, req: Request) => any