import { Auth, AuthVerification } from "@laratype/auth";
import { Controller, Request } from "@laratype/http";
import Admin from "../../../models/Admin";

export class AdminLoginController extends Controller {

  public async login(req: Request) {
    const authenticated = Auth.guard<Admin>('admin').user();
    const jwtToken = await authenticated.generateToken({
      name: "Default Token",
      abilities: "*",
    });

    const user = authenticated.getUser();

    return {
      user,
      token: jwtToken,
    }
  }

}