import { DataSource, EntityManager } from "typeorm"

export default class Model {
  public static manager: EntityManager;

  public static setDataSource(dataSource: DataSource) {
    return this.manager ??= dataSource.manager;
  }
}