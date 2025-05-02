import { defineRouteGroup } from "@laratype/http";
import { ServiceProvider } from "@laratype/support";
import { baseRouteApi } from "../../config/route/api";

export default class RouteServiceProvider extends ServiceProvider {

  public boot(): void {
    defineRouteGroup("/api", baseRouteApi, this)
  }
}