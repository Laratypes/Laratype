import { api } from "../routing/api/ApiRouter";
import { HTTP_APP, InternalException, ModelBindingRegistry } from "@laratype/support";

/** The registry `Route.model()` / `Route.bind()` writes, after checking its container belongs to a booted app. */
const bootedRegistry = (method: "Route.model()" | "Route.bind()") => {
  const container = ModelBindingRegistry.container();
  if(!container.has(HTTP_APP)) {
    throw new InternalException(
      `[@laratype/http] ${method} ran before an app was booted: the model binding registry resolves from a container without an HTTP_APP binding, so the binding would be lost. Fix: call ${method} from a provider boot() of a booted app (Serve.getContainer() / bootProviders()).`
    );
  }
  return ModelBindingRegistry.current();
};

export default class Route {

  /** Mounts the contract folder tree: `Route.api(appApi, (r) => [r.contract(users, UserController)]).mount(app)`. */
  static api = api;

  static model(paramName: string, modelClass: any) {
    bootedRegistry("Route.model()").bindings[paramName] = modelClass;
    return this;
  }

  static bind(paramName: string, callback: (value: string) => any) {
    bootedRegistry("Route.bind()").bindings[paramName] = callback;
    return this;
  }

}
