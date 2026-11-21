import { ContextApi } from "@laratype/support";
import type { Middleware as MiddlewareContract } from "../contracts";
import Request from "../supports/Request";

/**
 * The previous result of each middleware, per request. A binding can make one instance serve every request
 * (`singleton`), so the value cannot live on the instance (H21 #269). The outer key is the request's context store,
 * which lives exactly as long as the request (and does not change when `ContextApi.setRequest()` swaps the request);
 * the inner one is the middleware, so a middleware still reads its own value after `next()`.
 */
const previousResults = new WeakMap<object, WeakMap<object, unknown>>();

/** The value of each instance outside a request context (a middleware used by hand). */
const standaloneResults = new WeakMap<object, unknown>();

/** The context store of the current request, or undefined outside one. */
const currentStore = (): object | undefined => ContextApi.getRequestStore().getStore();

export default class Middleware<T = any> implements MiddlewareContract {

  /**
   * The 0.5 field, kept as an accessor over `getPreviousResult()` / `setPreviousResult()`: a 0.5 middleware that reads
   * or writes `this.previousResult` directly gets the request-local value.
   */
  protected get previousResult(): T | undefined {
    return this.getPreviousResult();
  }

  protected set previousResult(result: T | undefined) {
    this.setPreviousResult(result as T);
  }

  async handle(request: Request, res: Response, next: (request: Request) => Promise<unknown> | unknown) {
    // Middleware logic here
    return await next(request);
  }

  /** Request-local: a middleware bound as a singleton serves every request from the same instance. */
  setPreviousResult(result: T) {
    const store = currentStore();
    if (!store) {
      standaloneResults.set(this, result);
      return;
    }
    let byInstance = previousResults.get(store);
    if (!byInstance) {
      byInstance = new WeakMap();
      previousResults.set(store, byInstance);
    }
    byInstance.set(this, result);
  }

  /** The result the previous middleware passed to `next()`, for this request only. */
  getPreviousResult(): T | undefined {
    const store = currentStore();
    if (!store) {
      return standaloneResults.get(this) as T | undefined;
    }
    return previousResults.get(store)?.get(this) as T | undefined;
  }
}
