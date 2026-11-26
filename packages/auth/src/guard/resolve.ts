import { ContextApi } from "@laratype/support";
import AuthManager from "./AuthManager";

/** The `AuthManager` of the app container serving the current request. */
export const authManager = (): AuthManager => {
  // The request store, not ContextApi.getContainer(): outside a request that lookup is the app container (D11 #318),
  // and the guards need a request.
  const container = ContextApi.getRequestStore().getStore()?.container;
  if (!container) {
    throw new Error("[@laratype/auth] No app container: use Auth, AuthGuard and AuthVerification inside a request served by RequestKernel.");
  }
  if (!container.has(AuthManager)) {
    throw new Error("[@laratype/auth] AuthManager is not bound in the app container: boot PassportServiceProvider, which binds it from app/config/auth.ts.");
  }
  return container.make(AuthManager);
}
