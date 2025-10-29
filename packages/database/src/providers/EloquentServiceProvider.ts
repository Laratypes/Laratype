import { Log } from "@laratype/log";
import { camelize, Config, getProjectPath, ServiceProvider, ServiceProviderType } from "@laratype/support";
import { BaseEntity, DataSource } from "typeorm";
import DatabaseConnectionNotConfigYet from "../exceptions/DatabaseConnectionNotConfigYet";
import { globSync } from "glob";
import "reflect-metadata"

export default class DatabaseServiceProvider extends ServiceProvider {

  static type: ServiceProviderType.APP_PROVIDER;

  protected dataSource: DataSource | null = null;

  protected flattenModels(models: any[]): BaseEntity[] {
    const flattened = models.flatMap((item) => Object.values(item));

    return flattened as BaseEntity[];
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
      const models = this.flattenModels(instances);
      globalThis.__laratype_db.models = Object.fromEntries(models.map((m: any) => [m.name, m]));

      globalThis.__laratype_param_model_map ??= {};
      for (const modelName in globalThis.__laratype_db.models) {
        const modelCamel = camelize(modelName);
        globalThis.__laratype_param_model_map[modelCamel] = modelName;
      }
      
      this.dataSource = new DataSource({
        ...connectionDefault,
        entities: models,
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
  }

  public async boot() {
    try {
      globalThis.__laratype_db.ds = await this.initConnection();
    } catch (error) {
      console.log(error);
      Log.error(error);
    }
  }

  public async down(): Promise<void> {
    if(this.dataSource && this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }
}
