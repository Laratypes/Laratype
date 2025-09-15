import { Log } from "@laratype/log";
import { Config, getProjectPath, ServiceProvider } from "@laratype/support";
import { DataSource } from "typeorm";
import DatabaseConnectionNotConfigYet from "../exceptions/DatabaseConnectionNotConfigYet";
import "reflect-metadata"

export default class DatabaseServiceProvider extends ServiceProvider {

  protected dataSource: DataSource | null = null;

  public getDataSource()
  {
    if(!this.dataSource) {
      const defaultDatabaseDriver = Config.get(['database', 'default'] as const);
      if(!defaultDatabaseDriver) {
        throw new DatabaseConnectionNotConfigYet()
      }
      const connectionDefault = Config.get(['database', 'connections', defaultDatabaseDriver] as const)
      if(!connectionDefault) {
        throw new DatabaseConnectionNotConfigYet()
      }
      this.dataSource = new DataSource({
        ...connectionDefault,
        entities: [
          getProjectPath("src/models/*", false)
        ]
      })

    }
    return this.dataSource;
  }

  public async initConnection(){
    if(this.getDataSource().isInitialized) {
      return this.getDataSource();
    }
    return this.getDataSource().initialize()
    .then((res) => {
      console.log("Database connection established");
      return res;
    })
  }

  public async boot() {
    try {
      globalThis.__laratype_db.ds = await this.initConnection();
    } catch (error) {
      console.log(error);
      Log.error(error);
    }
  }
}