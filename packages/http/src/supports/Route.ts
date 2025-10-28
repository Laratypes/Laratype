
export default class Route {
  
  static model(paramName: string, modelClass: any) {
    globalThis.__laratype_route_model_bindings[paramName] = modelClass;
    return this;
  }

  static bind(paramName: string, callback: (value: any) => any) {
    globalThis.__laratype_route_model_bindings[paramName] = callback;
    return this;
  }

}
