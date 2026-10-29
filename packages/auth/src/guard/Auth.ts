import { Middleware, type NextHandler, type Request } from "@laratype/http";
import UnauthorizedException from "../exceptions/UnauthorizedException";
import { setAuthenticatedUser } from "../support/guardContext";
import { authManager } from "./resolve";

/** Authenticates the request with the default guard of the app container's `AuthManager` (A4 #151). */
export default class AuthGuard extends Middleware {

  getToken(request: Request) {
    return authManager().guard().token(request);
  }

  async handle(request: Request, res: Response, next: NextHandler) {
    const token = this.getToken(request);
    if (!token) {
      return Promise.reject(new UnauthorizedException({
        message: "Token is missing or invalid.",
      }));
    }
    const guard = authManager().guard();
    const user = await guard.verify(token);
    if (!user) {
      return Promise.reject(new UnauthorizedException({
        message: "Token is invalid or expired.",
      }));
    }
    // Auth.user()/login() then sign for this guard, not the default one (A6 #335)
    setAuthenticatedUser(user, guard.name);
    return next(request);
  }
}
