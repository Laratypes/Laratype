
export default class ModelManagement {

  static getModelByName(name: string) {
    return globalThis.__laratype_db.models?.[name] || null;
  }
}