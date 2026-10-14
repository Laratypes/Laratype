import { defineRouteGroup } from "@laratype/http";
import { RouteAppServiceProvider } from "@laratype/support";
import { baseRouteApi } from "../../routes/api";
import GreetingController from "../http/controllers/GreetingController";

export default class RouteServiceProvider extends RouteAppServiceProvider {

  public routes() {
    return defineRouteGroup("/api", baseRouteApi, this)
  }

  public boot() {
    super.boot()
    // The router builds controllers with `new` until #105, so this route resolves its controller from the kernel container.
    this.apps.get("/api/greeting", (c) => c.json(this.app.make(GreetingController).show()))
  }
}
