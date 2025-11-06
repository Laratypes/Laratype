import { Auth, AuthVerification } from "@laratype/auth";
import { Controller, Request } from "@laratype/http";
import { User } from "../../models/User";
import LoginRequest from "../requests/LoginRequest";
import UnauthorizedException from "../../exceptions/UnauthorizedException";

export default class LoginController extends Controller {

  public loginWithGoogle(req: Request) {
    return {
      test: true,
    }
  }
  
  public async login(req: Request) {
    const authenticated = Auth.user<User>()
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

  public async manualLogin(req: LoginRequest) {
    const data = req.validated();

    const attempt = await Auth.guard<User>('web').attempt(data)

    if(!attempt) {
      return new UnauthorizedException({
        message: "Invalid credentials",
      });
    }
    
    const jwtToken = await attempt.generateToken({
      name: "Default Token",
      abilities: "*",
    });

    const user = attempt.getUser();

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