import { Auth } from "@laratype/auth";
import { Controller } from "@laratype/http";
import type { Ctx } from "@laratype/http";
import { InvalidCredentials } from "../../../api/_errors";
import { toAdminProfile } from "../../../api/_schemas";
import adminLoginContract from "../../../api/admin/login";
import type Admin from "../../../models/Admin";

export default class AdminLoginController extends Controller {

  public async login({ body }: Ctx<typeof adminLoginContract.login>) {
    // The 0.5 route used `AdminLocalAuthentication`; v1 has no login middleware, so the controller runs the guard.
    const authenticated = await Auth.guard<Admin>('admin').attempt(body);
    if (!authenticated) throw InvalidCredentials();
    const token = await authenticated.generateToken({
      name: "Default Token",
      abilities: "*",
    });
    return {
      user: toAdminProfile(authenticated.getUser()),
      token,
    };
  }

}
