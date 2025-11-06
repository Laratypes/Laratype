
export default class ModelManagement {

  static getModelByName(name: string) {
    return globalThis.__laratype_db.models?.[name] || null;
  }

  static getPrimaryKeyFromModelInstance(modelInstance: any) {
    const model = this.getModelByName(modelInstance.constructor.name);
    return model.getRepository().metadata?.primaryColumns[0]?.propertyName;
  }
  
  static getPrimaryKeyFromModel(model: any) {
    return model.getRepository().metadata?.primaryColumns[0]?.propertyName;
  }
}