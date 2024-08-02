import { defineRouteGroup, ServiceProvider } from "@laratype/core";
import { baseRouteApi } from "../../config/route/api";

export default class RouteServiceProvider extends ServiceProvider {

  public boot(): void {
    defineRouteGroup("/api", baseRouteApi, this)
  }
}