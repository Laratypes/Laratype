import { Passport } from "@laratype/auth";
import { Middleware, type MiddlewareHandler } from "@laratype/http";

/**
 * The Google callback middleware: v1 has no OAuth-login API, so this keeps the 0.5 passport strategy and is mounted
 * through `r.contract(..., { endpoints: { ...: (r) => r.middleware(GoogleAuthentication) } })`.
 */
export class GoogleAuthentication extends Middleware {
  handle: MiddlewareHandler = async (request, res, next) => {
    // The api guard in app/config/auth.ts carries the google strategy; strategies register under the guard's name
    return (await Passport.authenticate("api", () => {
      return;
    }))(res, next);
  }
}
