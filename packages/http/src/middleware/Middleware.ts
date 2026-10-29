import { ContextApi } from "@laratype/support";
import type { Middleware as MiddlewareContract } from "../contracts";
import Request from "../supports/Request";

/**
 * The previous result of each middleware, per request. A binding can make one instance serve every request
 * (`singleton`), so the value cannot live on the instance (H21 #269). The outer key is the request, so an entry dies
 * with it; the inner one is the middleware, so a middleware still reads its own value after `next()`.
 */
const previousResults = new WeakMap<object, WeakMap<object, unknown>>();

/** The request of the current context, or undefined outside one (a middleware used by hand). */
const currentRequest = (): object | undefined => ContextApi.getRequestStore().getStore()?.request;

export default class Middleware<T = any> implements MiddlewareContract {

  /** The fallback outside a request context: inside one, `previousResults` holds the request's value for this instance. */
  protected previousResult: T | undefined;

  async handle(request: Request, res: Response, next: (request: Request) => Promise<unknown> | unknown) {
    // Middleware logic here
    return await next(request);
  }

  /** Request-local: a middleware bound as a singleton serves every request from the same instance. */
  setPreviousResult(result: T) {
    const request = currentRequest();
    if (!request) {
      this.previousResult = result;
      return;
    }
    let byInstance = previousResults.get(request);
    if (!byInstance) {
      byInstance = new WeakMap();
      previousResults.set(request, byInstance);
    }
    byInstance.set(this, result);
  }

  /** The result the previous middleware passed to `next()`, for this request only. */
  getPreviousResult(): T | undefined {
    const request = currentRequest();
    if (!request) {
      return this.previousResult;
    }
    return previousResults.get(request)?.get(this) as T | undefined;
  }
}
