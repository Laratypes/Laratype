import { Log } from "@laratype/log";
import { Config, getProjectPath, ServiceProvider } from "@laratype/support";
import { DataSource } from "typeorm";
import DatabaseConnectionNotConfigYet from "../exceptions/DatabaseConnectionNotConfigYet";
import { globSync } from "glob";
import "reflect-metadata"

export default class DatabaseServiceProvider extends ServiceProvider {

  protected dataSource: DataSource | null = null;

  protected flattenModels(models: any[]) {
    const flattened = models.flatMap((item) => Object.values(item));

    return flattened;
  }

  public async getDataSource()
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

      const path = getProjectPath("src/models/*", false);

      const files = globSync(path, {
        windowsPathsNoEscape: true
      });

      const instances = await Promise.all(files.map(file => this.transpile.ssrLoadModule(file)));
      this.dataSource = new DataSource({
        ...connectionDefault,
        entities: this.flattenModels(instances)
      })

    }
    return this.dataSource;
  }

  public async initConnection(){
    const ds = await this.getDataSource();
    if(ds.isInitialized) {
      return ds;
    }
    return ds.initialize()
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