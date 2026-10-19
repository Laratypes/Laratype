import { api } from "../routing/api/ApiRouter";

export default class Route {

  /** Mounts the contract folder tree: `Route.api(appApi, (r) => [r.contract(users, UserController)]).mount(app)`. */
  static api = api;

  static model(paramName: string, modelClass: any) {
    globalThis.__laratype_route_model_bindings[paramName] = modelClass;
    return this;
  }

  static bind(paramName: string, callback: (value: string) => any) {
    globalThis.__laratype_route_model_bindings[paramName] = callback;
    return this;
  }

}
