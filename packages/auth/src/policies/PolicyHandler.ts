import type { ExcludeFirstParameter } from "@laratype/support";
import Policy, { type Ability } from "./Policy";

export default class PolicyHandler {

  /** `policy` is the receiver: a `before()` override reading `this.<dep>` gets the container's instance (H21 #269). */
  static before (actor: unknown, ability: Ability, policy: Policy) {
    return policy.before(actor, ability);
  }

  public static can<P extends Policy, U extends Ability>(actor: any, policy: P, ability: U, ...args: ExcludeFirstParameter<P[U]>) {
    const before = this.before(actor, ability, policy);
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
