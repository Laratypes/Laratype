import Request from "../supports/Request";

export type MiddlewareHandler = (request: Request, res: Response, next: (request: Request) => Promise<unknown | unknown>) => Promise<unknown>

export default interface Middleware {
  handle: MiddlewareHandler
}

