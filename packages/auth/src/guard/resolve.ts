import { ContextApi } from "@laratype/support";
import AuthManager from "./AuthManager";

/** The `AuthManager` of the app container serving the current request. */
export const authManager = (): AuthManager => {
  // The request's container only: `ContextApi.getContainer()` also answers with the app container outside a request
  // (D11 #318), where a guard has no request to authenticate
  const container = ContextApi.getRequestStore().getStore()?.container;
  if (!container) {
    throw new Error("[@laratype/auth] No app container: use Auth, AuthGuard and AuthVerification inside a request served by RequestKernel.");
  }
  if (!container.has(AuthManager)) {
    throw new Error("[@laratype/auth] AuthManager is not bound in the app container: boot PassportServiceProvider, which binds it from app/config/auth.ts.");
  }
  return container.make(AuthManager);
}
