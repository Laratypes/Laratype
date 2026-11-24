import { Auth } from "@laratype/auth";
import type { Authenticated } from "@laratype/auth";
import { Controller } from "@laratype/http";
import type { Ctx } from "@laratype/http";
import { InvalidCredentials } from "../../api/_errors";
import { toUserProfile } from "../../api/_schemas";
import { issueDefaultToken } from "./authToken";
import callbackContract from "../../api/callback";
import googleCallbackContract from "../../api/google/callback";
import loginContract from "../../api/login";
import manualLoginContract from "../../api/login/manual";
import type User from "../../models/User";

export default class LoginController extends Controller {

  public async login({ body }: Ctx<typeof loginContract.login>) {
    return this.attempt(body);
  }

  public async manualLogin({ body }: Ctx<typeof manualLoginContract.manualLogin>) {
    // The 0.5 route used `LocalAuthentication`; v1 has no login middleware, so the controller runs the guard directly.
    return this.attempt(body);
  }

  public handleGoogleLogin(_ctx: Ctx<typeof callbackContract.handleGoogleLogin>) {
    return { callback: true };
  }

  public handleGoogleCallback(_ctx: Ctx<typeof googleCallbackContract.handleGoogleCallback>) {
    return { callback: true };
  }

  private async attempt(body: Ctx<typeof loginContract.login>["body"]) {
    const authenticated = await Auth.guard("web").attempt(body);
    if (!authenticated) throw InvalidCredentials();
    return this.respond(authenticated);
  }

  private async respond(authenticated: Authenticated<User>) {
    return {
      user: toUserProfile(authenticated.getUser()),
      token: await issueDefaultToken(authenticated),
    };
  }

}
