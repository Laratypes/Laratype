import { api } from "../routing/api/ApiRouter";
import { ModelBindingRegistry } from "@laratype/support";

export default class Route {

  /** Mounts the contract folder tree: `Route.api(appApi, (r) => [r.contract(users, UserController)]).mount(app)`. */
  static api = api;

  static model(paramName: string, modelClass: any) {
    ModelBindingRegistry.current().bindings[paramName] = modelClass;
    return this;
  }

  static bind(paramName: string, callback: (value: string) => any) {
    ModelBindingRegistry.current().bindings[paramName] = callback;
    return this;
  }

}
