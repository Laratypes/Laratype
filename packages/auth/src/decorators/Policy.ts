import { MetaDataKey } from "@laratype/support";
import { Policy } from "../policies";

type PolicyDerived = { new(): Policy } & typeof Policy;

type ExcludeFirstParameter<T extends (...args: any) => any> =
  T extends (first: any, ...rest: infer R) => any ? R : never;

type Ability = Exclude<keyof Policy, 'before'>;

export interface UsePolicy<T extends Policy> {
  can<U extends Ability>(ability: U, ...args: ExcludeFirstParameter<T[U]>): ReturnType<T[U]>;
  cannot<U extends Ability>(ability: U, ...args: ExcludeFirstParameter<T[U]>): ReturnType<T[U]>;
}

export function UsePolicy(P: PolicyDerived) {
  return function <T extends { new(...args: any[]): {} }>(target: T) {
    Reflect.defineMetadata(MetaDataKey.POLICY, P, target);

    const before = (target: any, ability: Ability, cb: Policy['before']) => {
      return cb(target, ability);
    }

    const policy = new P();

    const objClass = {
      [target.name]: class extends target implements UsePolicy<any> {
        can(ability: Ability, ...args: any) {
          
          const authorized = before(this, ability, policy.before);
          if(typeof authorized === 'boolean') {
            return authorized;
          }

          const method = policy[ability].bind(policy);
          return method(this, ...args) || false;
        }

        cannot(ability: Ability, ...args: any) {
          const authorized = before(this, ability, policy.before);
          if(typeof authorized === 'boolean') {
            return authorized;
          }

          const method = policy[ability].bind(policy);
          const result = method(this, ...args);
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
