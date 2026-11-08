import ModelBindingRegistry from "../registries/ModelBindingRegistry";

export default class ModelManagement {

  static getModelByName(name: string) {
    return ModelBindingRegistry.current().models[name] || null;
  }

  static getPrimaryKeyFromModelInstance(modelInstance: any) {
    const model = this.getModelByName(modelInstance.constructor.name);
    return model.getRepository().metadata?.primaryColumns[0]?.propertyName;
  }
  
  static getPrimaryKeyFromModel(model: any) {
    return model.getRepository().metadata?.primaryColumns[0]?.propertyName;
  }
}
