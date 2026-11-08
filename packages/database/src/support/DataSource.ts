import { Facade } from "@laratype/core";
import { DataSource } from "typeorm";
import DataSourceNotInitYet from "../exceptions/DataSourceNotInitYet";

/**
 * The app's initialized DataSource: `DatabaseServiceProvider.boot()` binds it in the app container (D7 #114).
 * @deprecated Resolve `DataSource` from the container instead of importing this proxy.
 */
const DS = new Proxy({} as DataSource, {
  get(_target, prop) {
    const app = Facade.getFacadeApplication();
    if(!app.has(DataSource)) {
      throw new DataSourceNotInitYet();
    }
    const ds = app.make(DataSource);
    const value = Reflect.get(ds, prop, ds);
    return typeof value === "function" ? value.bind(ds) : value;
  },
}) as DataSource;

export default DS;
