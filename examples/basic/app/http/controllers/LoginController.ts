import { Auth } from "@laratype/auth";
import type { Authenticated } from "@laratype/auth";
import { Controller } from "@laratype/http";
import type { Ctx } from "@laratype/http";
import { InvalidCredentials } from "../../api/_errors";
import { toUserProfile } from "../../api/_schemas";
import callbackContract from "../../api/callback";
import googleCallbackContract from "../../api/google/callback";
import loginContract from "../../api/login";
import manualLoginContract from "../../api/login/manual";
import type User from "../../models/User";

export default class LoginController extends Controller {

  public async login({ body }: Ctx<typeof loginContract.login>) {
    const authenticated = await Auth.guard('web').attempt(body);
    if (!authenticated) throw InvalidCredentials();
    return this.respond(authenticated);
  }

  public async manualLogin({ body }: Ctx<typeof manualLoginContract.manualLogin>) {
    // The 0.5 route used `LocalAuthentication`; v1 has no login middleware, so the controller runs the guard directly.
    const authenticated = await Auth.guard('web').attempt(body);
    if (!authenticated) throw InvalidCredentials();
    return this.respond(authenticated);
  }

  public handleGoogleLogin(_ctx: Ctx<typeof callbackContract.handleGoogleLogin>) {
    return { callback: true };
  }

  public handleGoogleCallback(_ctx: Ctx<typeof googleCallbackContract.handleGoogleCallback>) {
    return { callback: true };
  }

  private async respond(authenticated: Authenticated<User>) {
    const token = await authenticated.generateToken({
      name: "Default Token",
      abilities: "*",
    });
    return {
      user: toUserProfile(authenticated.getUser()),
      token,
    };
  }

}
