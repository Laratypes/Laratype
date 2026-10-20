import { Auth } from "@laratype/auth";
import { Controller, Request } from "@laratype/http";
import Admin from "../../../models/Admin";
import UnauthorizedException from "../../../exceptions/UnauthorizedException";

export class AdminLoginController extends Controller {

  public async login(req: Request) {
    const authenticated = Auth.guard<Admin>('admin').user();
    // The auth middleware runs before this handler; no user means the request is not signed in
    if(!authenticated) throw new UnauthorizedException({ httpCode: 401, message: "Not signed in." });
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