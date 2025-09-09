import { Middleware as MiddlewareContract } from "../contracts";
import Request from "../supports/Request";

export default class Middleware<T = any> implements MiddlewareContract {

  protected previousResult: T | undefined;

  async handle(request: Request, res: Response, next: (request: Request) => Promise<unknown> | unknown) {
    // Middleware logic here
    return await next(request);
  }

  setPreviousResult(result: T) {
    this.previousResult = result;
  }

  getPreviousResult(): T | undefined {
    return this.previousResult;
  }
}
