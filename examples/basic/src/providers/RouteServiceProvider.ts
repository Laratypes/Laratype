import { defineRouteGroup } from "@laratype/http";
import { AppServiceProvider } from "@laratype/support";
import { baseRouteApi } from "../../routes/api";

export default class RouteServiceProvider extends AppServiceProvider {

  public boot(): void {
    defineRouteGroup("/api", baseRouteApi, this)
  }
}