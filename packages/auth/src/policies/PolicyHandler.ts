import { ExcludeFirstParameter } from "@laratype/support";
import Policy, { Ability } from "./Policy";

export default class PolicyHandler {

  static before (target: any, ability: Ability, cb: Policy['before']) {
    return cb(target, ability);
  }

  public static can<P extends Policy, U extends Ability>(actor: any, policy: P, ability: U, ...args: ExcludeFirstParameter<P[U]>) {
    const before = this.before(actor, ability, policy.before);
    if(typeof before === 'boolean') {
      return before;
    }

    const method = policy[ability].bind(policy);
    const result = method(actor, ...args);

    if(result instanceof Promise) {
      return result.then(res => res || false);
    }
    return result || false;
  }
}
