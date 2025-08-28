import { Middleware as MiddlewareContract } from "../contracts";
import Request from "../supports/Request";
export default class Middleware implements MiddlewareContract {
  async handle(request: Request, next: (request: Request) => Promise<unknown> | unknown) {
    // Middleware logic here
    return await next(request);
  }
}