import User from "../models/User";
import Admin from "../models/Admin";

/**
 * The admin endpoints' policy (H8 #122). `before` is the 0.5 rule: a User actor is refused even if a guard is ever
 * misconfigured to authenticate one for an admin route, so the policy chain keeps that defence in depth.
 */
export default class AdminPolicy {

  public me(actor: User | Admin): boolean {
    return actor instanceof Admin;
  }

  public show(actor: User | Admin, admin: Admin): boolean {
    return true;
  }

  /** Any authenticated Admin may create an admin; `before` still refuses a User actor. */
  public register(actor: User | Admin): boolean {
    return actor instanceof Admin;
  }

  public before(actor: User | Admin, ability: string): boolean | null {
    if (actor instanceof User) return false;
    return null;
  }

}
