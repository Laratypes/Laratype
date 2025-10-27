import { DataSource } from "typeorm";
import DataSourceNotInitYet from "../exceptions/DataSourceNotInitYet";

if(!globalThis.__laratype_db) {
  globalThis.__laratype_db = {
    ds: {} as DataSource,
    models: {},
  }
}

const DS = new Proxy(globalThis.__laratype_db.ds, {
  get(target, prop, receiver) {
    if(!globalThis.__laratype_db.ds) {
      throw new DataSourceNotInitYet();
    }
    return Reflect.get(globalThis.__laratype_db.ds, prop, receiver);
  },
  set(target, prop, value, receiver) {
    return Reflect.set(target, prop, value, receiver);
  }
}) as DataSource;

export default DS;
