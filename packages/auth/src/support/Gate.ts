import { Gate } from "../gate";

export default class GateGuard {

  static allows<T extends Gate>(gate: T, ...args: Parameters<T['handle']>) {
    return gate.handle(...args) === true
  }

  static denies(user: any, ability: string) {
    return !this.allows(user, ability);
  }

}
