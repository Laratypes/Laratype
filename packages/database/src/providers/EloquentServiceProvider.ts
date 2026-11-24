import { Log } from "@laratype/log";
import { appManifest, camelize, Config, ModelBindingRegistry, ServiceProvider, ServiceProviderType } from "@laratype/support";
import type { ManifestEntry } from "@laratype/support";
import { BaseEntity, DataSource } from "typeorm";
import DatabaseConnectionNotConfigYet from "../exceptions/DatabaseConnectionNotConfigYet";
import ModelError from "../exceptions/ModelError";
import "reflect-metadata"

/** The Model's message text, in one place (errors-and-comments.md › Errors). */
const errors = {
  unnamed: (index: number): string =>
    `[@laratype/database] the app manifest's models[${index}] has no name: a model entry carries the model file's name`,
  unpathed: (index: number): string =>
    `[@laratype/database] the app manifest's models[${index}] has no path: a model entry carries the source file it loads`,
  proto: (path: string): string =>
    `[@laratype/database] ${path}: a model file cannot be named \`__proto__\`: every object reads it as its prototype,`
    + " so the binding would be dropped",
  duplicate: (first: string, second: string, key: string): string =>
    `[@laratype/database] ${first} and ${second} are both the implicit model \`${key}\`: rename one (a model file's name`
    + " is its path param)",
  noDefault: (path: string): string =>
    `[@laratype/database] ${path} has no default export: a model file exports its model class as the default export for`
    + " implicit binding",
  notBindable: (path: string): string =>
    `[@laratype/database] ${path}: the default export is not a BindableModel (static primaryKey, optional routeKeyName,`
    + " findByRouteKey(key))",
};

/**
 * The v1 implicit bindings of the app manifest's models (docs/v1/http.md › Model binding, H14 #163): `camelize(<file
 * name>)` → the module's default export, the keys `sauf`'s `models.d.ts` writes. One model per file, so the key is
 * the path param. Every model file must default-export a BindableModel (D2): no default export, a non-bindable default
 * and two files whose names camelize alike are configuration errors at boot, in the house `ModelError` style.
 * Exported for the tests only; the package index does not re-export it.
 * @internal
 */
export function implicitRouteModels(entries: readonly ManifestEntry[], modules: readonly unknown[]): Record<string, unknown> {
  const models = new Map<string, unknown>();
  const paths = new Map<string, string>();
  entries.forEach((entry, index) => {
    if (typeof entry?.name !== "string" || entry.name === "") {
      throw new ModelError(errors.unnamed(index));
    }
    if (typeof entry.path !== "string" || entry.path === "") {
      throw new ModelError(errors.unpathed(index));
    }
    const key = camelize(entry.name);
    if (key === "__proto__") {
      throw new ModelError(errors.proto(entry.path));
    }
    const other = paths.get(key);
    if (other !== undefined) {
      throw new ModelError(errors.duplicate(other, entry.path, key));
    }
    const exported = (modules[index] as { default?: unknown } | null | undefined)?.default;
    if (exported === undefined || exported === null) {
      throw new ModelError(errors.noDefault(entry.path));
    }
    // `primaryKey` is read through `in`, never invoked: on the base Model it is a getter that needs the DataSource,
    // which this runs before. `findByRouteKey` is a plain static.
    if (
      typeof exported !== "function" ||
      !("primaryKey" in exported) ||
      typeof (exported as { findByRouteKey?: unknown }).findByRouteKey !== "function"
    ) {
      throw new ModelError(errors.notBindable(entry.path));
    }
    paths.set(key, entry.path);
    models.set(key, exported);
  });
  // fromEntries, not assignments: a key named `constructor` or `toString` is an own property, never a prototype member
  return Object.fromEntries(models);
}

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

      // The model files of the app manifest (docs/v1/build.md › Plugin chain)
      const modelEntries = appManifest().models;
      const instances = await Promise.all(modelEntries.map(entry => entry.load()));
      const models = this.flattenModels(instances);
      if (!this.app.has(ModelBindingRegistry)) this.app.singleton(ModelBindingRegistry);
      const registry = this.app.make(ModelBindingRegistry);
      registry.models = Object.fromEntries(models.map((m: any) => [m.name, m]));

      for (const modelName in registry.models) {
        const modelCamel = camelize(modelName);
        registry.paramModelMap[modelCamel] = modelName;
      }

      // The v1 implicit map `Route.api` reads (H14 #163): the manifest's files, not the 0.5 class names, so the path
      // param is exactly the key `sauf types:generate` writes into `.laratype/types/models.d.ts`
      registry.routeModels = implicitRouteModels(modelEntries, instances);

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
      this.app.instance(DataSource, await this.initConnection());
    } catch (error) {
      // A model folder the implicit binding cannot key is a configuration error (D2): fail the boot, never serve a
      // route whose params promise a model the registry does not have. A connection error keeps the 0.5 log-and-run.
      if (error instanceof ModelError) throw error;
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
