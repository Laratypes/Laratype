import { Gate } from "@laratype/auth";
import User from "../models/User";
import Admin from "../models/Admin";

export default class UpdateUserGate extends Gate {

  handle(actor: User | Admin, user: User): boolean {
    if(actor instanceof Admin) {
      return true;
    }
    if(user.id === actor.id) {
      return true;
    }
    return false;
  }
}
