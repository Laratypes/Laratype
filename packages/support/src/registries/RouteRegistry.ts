import { Facade } from "@laratype/core";

/**
 * The routes the app's `RouteAppServiceProvider`s mounted (docs/v1/http.md › Router v2 › Registry).
 * `RouteAppServiceProvider.boot()` binds it in the app container, `sauf route:list` reads it.
 */
export default class RouteRegistry {

  constructor(public routes: Array<Record<string, any>> = []) {}

  /** The registry of the app container: the facade application `Serve` sets. */
  static current(): RouteRegistry {
    // No HTTP_APP check: route registration writes through RouteAppServiceProvider.boot() into this.app (an
    // AppServiceProvider, so HTTP_APP is bound), and this lazy empty registry only serves lenient reads (route:list).
    const app = Facade.getFacadeApplication();
    if(!app.has(RouteRegistry)) {
      app.instance(RouteRegistry, new RouteRegistry());
    }
    return app.make(RouteRegistry);
  }

}
