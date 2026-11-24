import { RouteAppServiceProvider } from "@laratype/support";
import { apiRoutes } from "../routes/api";

export default class RouteServiceProvider extends RouteAppServiceProvider {

  public routes() {
    return [
      ...apiRoutes.mount(this.apps),
    ];
  }

}
