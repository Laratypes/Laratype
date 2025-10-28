
import { Controller, Request } from "@laratype/http";
import { Admin } from "../../../models/Admin";
import { Auth } from "@laratype/auth";


export default class AdminHomeController extends Controller {

  async me() {
    const user = Auth.user<Admin>();
    return user;
  }

  async show(request: Request, models: { admin: Admin }) {
    return models.admin;
  }
}