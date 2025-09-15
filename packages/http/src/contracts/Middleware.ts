import Request from "../supports/Request";

export type NextHandler = (request: Request) => Promise<unknown | unknown>

export type MiddlewareHandler = (request: Request, res: Response, next: NextHandler) => Promise<unknown>

export default interface Middleware {
  handle: MiddlewareHandler
}

