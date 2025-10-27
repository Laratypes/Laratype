import { Auth, AuthVerification } from "@laratype/auth";
import { Controller, Request } from "@laratype/http";
import { Admin } from "../../../models/Admin";

export class AdminLoginController extends Controller {

  public async login(req: Request) {
    const user = Auth.user<Admin>()
    const jwtToken = await AuthVerification.guard('admin').sign(user, {
      name: "Default Token",
      abilities: "*",
    });

    return {
      user,
      token: jwtToken,
    }
  }

}