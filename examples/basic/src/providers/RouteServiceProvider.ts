import { defineRouteGroup } from "@laratype/http";
import { ServiceProvider } from "@laratype/support";
import { baseRouteApi } from "../../routes/api";

export default class RouteServiceProvider extends ServiceProvider {

  public boot(): void {
    defineRouteGroup("/api", baseRouteApi, this)
  }
}