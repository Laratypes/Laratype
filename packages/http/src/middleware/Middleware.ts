import { ContextApi } from "@laratype/support";
import type { Middleware as MiddlewareContract } from "../contracts";
import Request from "../supports/Request";

/**
 * The previous result of each request in flight, keyed by its request instance. A binding can make one middleware
 * instance serve every request (`singleton`), so the value cannot live on the instance (H21 #269).
 */
const previousResults = new WeakMap<object, unknown>();

/** The request of the current context, or undefined outside one (a middleware used by hand). */
const currentRequest = (): object | undefined => ContextApi.getRequestStore().getStore()?.request;

export default class Middleware<T = any> implements MiddlewareContract {

  /** The fallback outside a request context: inside one, the request's entry in `previousResults` holds the value. */
  protected previousResult: T | undefined;

  async handle(request: Request, res: Response, next: (request: Request) => Promise<unknown> | unknown) {
    // Middleware logic here
    return await next(request);
  }

  /** Request-local: a middleware bound as a singleton serves every request from the same instance. */
  setPreviousResult(result: T, request?: object) {
    const target = request ?? currentRequest();
    if (target) {
      previousResults.set(target, result);
      return;
    }
    this.previousResult = result;
  }

  /** The result the previous middleware passed to `next()`, for this request only. */
  getPreviousResult(request?: object): T | undefined {
    const target = request ?? currentRequest();
    if (target) {
      return previousResults.get(target) as T | undefined;
    }
    return this.previousResult;
  }
}
