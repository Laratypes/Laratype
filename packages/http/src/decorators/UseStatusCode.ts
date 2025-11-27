

import { MetaDataKey, StatusCode } from "@laratype/support";

export function UseStatusCode(statusCode: StatusCode) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    Reflect.defineMetadata(MetaDataKey.CONTROLLER_STATUS_CODE, statusCode, target, propertyKey);
  };
}