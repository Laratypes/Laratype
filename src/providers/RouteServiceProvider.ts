import { baseRouteApi } from "../../config/route/api";
import { createNestedRouter } from "../../core/routing/Route";
import ServiceProvider from "../../core/service/ServiceProvider";

export default class RouteServiceProvider extends ServiceProvider {

  public boot(): void {
    console.log("OK");
    this.apps.route('/api', createNestedRouter(baseRouteApi));
  }
}