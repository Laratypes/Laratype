import { Middleware, NextHandler, Request } from "@laratype/http";
import { ContextApi } from "@laratype/support";
import UnauthorizedException from "../exceptions/UnauthorizedException";
import { AuthVerification } from "../verifications";

export default class AuthGuard extends Middleware {

  getToken(request: Request) {
    const authHeader = request.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.split('Bearer ')[1].trim();
    }
  }

  async handle(request: Request, res: Response, next: NextHandler) {
    const token = this.getToken(request);
    if (!token) {
      return Promise.reject(new UnauthorizedException({
        message: "Token is missing or invalid.",
      }));
    }
    const user = await AuthVerification.verify(token);
    if (!user) {
      return Promise.reject(new UnauthorizedException({
        message: "Token is invalid or expired.",
      }));
    }
    ContextApi.setUser(user);
    return next(request);
  }
}
