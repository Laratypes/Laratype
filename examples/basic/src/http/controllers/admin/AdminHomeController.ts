
import { Controller } from "@laratype/http";
import { Admin } from "../../../models/Admin";
import { Auth } from "@laratype/auth";


export default class AdminHomeController extends Controller {

  async me() {
    const user = Auth.user<Admin>();
    return user;
  }
}