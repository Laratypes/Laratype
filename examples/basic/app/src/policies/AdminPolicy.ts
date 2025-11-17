import { Policy } from "@laratype/auth";
import User from "../models/User";
import Admin from "../models/Admin";

export default class AdminPolicy extends Policy {

  viewAny(actor: User | Admin, user: User): boolean | null {
    return true;
  }

  view(actor: User | Admin, user: User): boolean | null {
    return true;
  }

  create(actor: User | Admin, user: User): boolean | null {
    return true;
  }

  update(actor: User | Admin, user: User): boolean | null {
    return true;
  }

  delete(actor: User | Admin, user: User) {
    return actor.id === user.id
  }

  restore(actor: User | Admin, user: User): boolean | null {
    return true;
  }

  forceDelete(actor: User | Admin, user: User): boolean | null {
    return true;
  }

  public before(actor: User | Admin, ability: string): boolean | null {
    if(actor instanceof User) return false;
    return null;
  }
  
}
