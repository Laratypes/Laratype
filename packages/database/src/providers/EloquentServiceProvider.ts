import { Log } from "@laratype/log";
import { Config, getProjectPath, ServiceProvider } from "@laratype/support";
import { DataSource } from "typeorm";
import Model from "../eloquent/Model";
import DatabaseConnectionNotConfigYet from "../exceptions/DatabaseConnectionNotConfigYet";

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

      Model.setDataSource(this.dataSource);
    }
    return this.dataSource;
  }

  public async initConnection(){
    if(this.getDataSource().isInitialized) {
      return this.getDataSource();
    }
    return this.getDataSource().initialize()
    .then(() => {
      console.log("Database connection established");
    })
    .catch((error) => {
      console.log(error);
      Log.error(error);
    })
  }

  public async boot() {
    await this.initConnection();
  }
}