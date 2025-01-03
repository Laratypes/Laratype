import Controller from "../controller/Controller"
import Middleware from "../middleware/Middleware"
import Request from "../supports/Request";
import { METHOD } from "./Request";

export { };

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

export type RouteParams = {
  method: METHOD,
  path: string,
  request?: typeof Request,
  controller: ReturnType<Controller['__invoke']>,
  middleware?: Array<Middleware>,
  name?: string,
  meta?: any,
}
