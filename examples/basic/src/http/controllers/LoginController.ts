import { Auth } from "@laratype/auth";
import { Controller, Request } from "@laratype/http";
import { User } from "../../models/User";

export class LoginController extends Controller {

  public loginWithGoogle(req: Request) {
    return {
      test: true,
    }
  }
  
  public login(req: Request) {
    const user = Auth.user<User>()
    return user
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