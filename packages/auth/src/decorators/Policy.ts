import { type ExcludeFirstParameter, MetaDataKey } from "@laratype/support";
import type { Newable } from "@laratype/core";
import { RequestKernel } from "@laratype/http";
import type { Policy } from "../policies";
import type { Ability } from "../policies/Policy";
import PolicyHandler from "../policies/PolicyHandler";

export interface UsePolicy<T extends Policy> {
  can<U extends Ability>(ability: U, ...args: ExcludeFirstParameter<T[U]>): ReturnType<T[U]>;
  cannot<U extends Ability>(ability: U, ...args: ExcludeFirstParameter<T[U]>): ReturnType<T[U]>;
}

/**
 * `P` may take constructor dependencies: the route pipeline and the model-level `can()`/`cannot()` resolve the class
 * from the request's container (H21 #269). Recording it constructs nothing, so defining the model needs no container.
 */
export function UsePolicy(P: Newable<Policy>) {
  return function <T extends { new(...args: any[]): {} }>(target: T) {
    Reflect.defineMetadata(MetaDataKey.POLICY, P, target);

    const objClass = {
      [target.name]: class extends target implements UsePolicy<any> {
        can(ability: Ability, ...args: any) {
          return PolicyHandler.can(this, RequestKernel.container().make(P), ability, ...args);
        }

        cannot(ability: Ability, ...args: any) {
          const result = PolicyHandler.can(this, RequestKernel.container().make(P), ability, ...args);
          if(result instanceof Promise) {
            return result.then(res => !res);
          }
          return !result;
        }
      }
    }[target.name];

    return objClass;
  }
}
