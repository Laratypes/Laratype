import { Auth, AuthVerification } from "@laratype/auth";
import { Controller, Request } from "@laratype/http";
import { User } from "../../models/User";

export default class LoginController extends Controller {

  public loginWithGoogle(req: Request) {
    return {
      test: true,
    }
  }
  
  public async login(req: Request) {
    const user = Auth.user<User>()
    const jwtToken = await AuthVerification.sign(user, {
      name: "Default Token",
      abilities: "*",
    });

    return {
      user,
      token: jwtToken,
    }
  }

  public handleGoogleCallback(req: Request) {
    return {
      callback: true,
    }
  }
  
  public handleGoogleLogin(req: Request) {
    return {
      callback: true,
    }
  }
}