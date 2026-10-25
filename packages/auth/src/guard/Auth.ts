import { Middleware, type NextHandler, type Request } from "@laratype/http";
import { ContextApi } from "@laratype/support";
import UnauthorizedException from "../exceptions/UnauthorizedException";
import { authManager } from "./resolve";

/** Authenticates the request with the default guard of the app container's `AuthManager` (A4 #151). */
export default class AuthGuard extends Middleware {

  getToken(request: Request) {
    return authManager().guard().token(request);
  }

  async handle(request: Request, res: Response, next: NextHandler) {
    const guard = authManager().guard();
    const token = guard.token(request);
    if (!token) {
      return Promise.reject(new UnauthorizedException({
        message: "Token is missing or invalid.",
      }));
    }
    const user = await guard.verify(token);
    if (!user) {
      return Promise.reject(new UnauthorizedException({
        message: "Token is invalid or expired.",
      }));
    }
    ContextApi.setUser(user);
    return next(request);
  }
}
