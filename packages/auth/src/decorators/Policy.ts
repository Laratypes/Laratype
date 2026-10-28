import { type ExcludeFirstParameter, MetaDataKey } from "@laratype/support";
import type { Newable } from "@laratype/core";
import { Policy } from "../policies";
import type { Ability } from "../policies/Policy";
import PolicyHandler from "../policies/PolicyHandler";

export interface UsePolicy<T extends Policy> {
  can<U extends Ability>(ability: U, ...args: ExcludeFirstParameter<T[U]>): ReturnType<T[U]>;
  cannot<U extends Ability>(ability: U, ...args: ExcludeFirstParameter<T[U]>): ReturnType<T[U]>;
}

/** `P` may take constructor dependencies: the request pipeline resolves it from the container (H21 #269). */
export function UsePolicy(P: Newable<Policy>) {
  return function <T extends { new(...args: any[]): {} }>(target: T) {
    Reflect.defineMetadata(MetaDataKey.POLICY, P, target);

    const policy = new P();

    const objClass = {
      [target.name]: class extends target implements UsePolicy<any> {
        can(ability: Ability, ...args: any) {
          return PolicyHandler.can(this, policy, ability, ...args);
        }

        cannot(ability: Ability, ...args: any) {
          const result = PolicyHandler.can(this, policy, ability, ...args);
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
