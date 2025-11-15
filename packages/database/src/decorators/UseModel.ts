

import { MetaDataKey } from "@laratype/support";
import Model from "../eloquent/Model";

export function UseModel(M: typeof Model) {
  return function <T extends { new(...args: any[]): {} }>(target: T) {
    Reflect.defineMetadata(MetaDataKey.MODEL_FACTORY, M, target);
  }
}