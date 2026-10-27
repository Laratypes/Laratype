import { ContextApi } from "@laratype/support";
import AuthManager from "./AuthManager";

/** The `AuthManager` of the app container serving the current request. */
export const authManager = (): AuthManager => {
  const container = ContextApi.getContainer();
  if (!container) {
    throw new Error("[@laratype/auth] No app container: use Auth, AuthGuard and AuthVerification inside a request served by RequestKernel.");
  }
  if (!container.has(AuthManager)) {
    throw new Error("[@laratype/auth] AuthManager is not bound in the app container: boot PassportServiceProvider, which binds it from app/config/auth.ts.");
  }
  return container.make(AuthManager);
}
