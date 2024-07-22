import { baseRouteApi } from "../../config/route/api";
import { defineRouteGroup } from "../../core/routing/Route";
import ServiceProvider from "../../core/support/ServiceProvider";

export default class RouteServiceProvider extends ServiceProvider {

  public boot(): void {
    defineRouteGroup("/api", baseRouteApi, this)
  }
}