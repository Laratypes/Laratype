import { Facade } from "@laratype/core";
import ContextApi from "../context/ContextApi";

/**
 * The 0.5 route model bindings (docs/v1/http.md › Model binding): the `Route.model()` / `Route.bind()` entries,
 * the camelCase param → model name map and the app's model classes by name.
 * `AppServiceProvider` binds it in the app container; RequestKernel.boot() clears its route bindings. H7 #118
 * replaces it with `BindableModel`.
 */
export default class ModelBindingRegistry {

  /** `Route.model()` / `Route.bind()`: param name → model class or `(value) => model` callback. */
  public bindings: Record<string, any> = {};

  /** camelCase param name → model class name, for the implicit binding of a `[param]` folder. */
  public paramModelMap: Record<string, string> = {};

  /** Model class name → model class: the app's TypeORM entities (the old `__laratype_db.models`). */
  public models: Record<string, any> = {};

  /** The request's registry, else the app container's (the facade application `Serve` sets). */
  static current(): ModelBindingRegistry {
    const app = ContextApi.getContainer() ?? Facade.getFacadeApplication();
    if(!app.has(ModelBindingRegistry)) {
      app.singleton(ModelBindingRegistry);
    }
    return app.make(ModelBindingRegistry);
  }

}
