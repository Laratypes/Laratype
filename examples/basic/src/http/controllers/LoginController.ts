import { Controller, Request } from "@laratype/http";

export class LoginController extends Controller {

  public loginWithGoogle(req: Request) {
    return {
      test: true,
    }
  }

  public handleGoogleCallback(req: Request) {
    return {
      callback: true,
    }
  }
}