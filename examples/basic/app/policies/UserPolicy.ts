import type User from "../models/User";
import type Admin from "../models/Admin";

/**
 * The users endpoints' policy (H8 #122): the ability is the endpoint key, so `index` / `show` / `store` keep the
 * answers of the 0.5 `viewAny` / `view` / `create` methods.
 */
export default class UserPolicy {

  public index(actor: User | Admin): boolean {
    return true;
  }

  public show(actor: User | Admin): boolean {
    return true;
  }

  public store(actor: User | Admin): boolean {
    return true;
  }

  public update(actor: User | Admin): boolean {
    return true;
  }

  public delete(actor: User | Admin, user: User): boolean {
    return actor.id === user.id;
  }

  public before(actor: User | Admin, ability: string): boolean | null {
    return null;
  }

}
