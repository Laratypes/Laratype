import { ContextApi } from "@laratype/support";
import { Facade } from "@laratype/core";
import type { Model } from "@laratype/database";
import { Authenticated } from "../verifications/AuthVerification";
import { authManager } from "../guard/resolve";
import { authenticatedGuard } from "./guardContext";

class Authenticate<T extends Model> {

  protected guardName?: string;
  protected authenticated?: Authenticated<T>;

  /** `guardName` is resolved by the app container's `AuthManager`; the default guard when omitted. */
  constructor(guardName?: string) {
    this.guardName = guardName;
  }

  protected guard() {
    return authManager().guard<T>(this.guardName);
  }

  async attempt(fields: Record<string, any>) {
    const guard = this.guard();

    const user = await guard.attempt(fields)

    if(!user) {
      return false;
    }

    this.authenticated = new Authenticated<T>(user, guard)

    return this.authenticated;
  }

  setUser(user: T) {
    this.authenticated = new Authenticated<T>(user, this.guard())

    return this.authenticated;
  }

  user() {
    return this.authenticated;
  }

  id<A>(): A {
    throw new Error("Method not implemented.");
  }

  check(): boolean {
    throw new Error("Method not implemented.");
  }

  login(user: T){
    this.authenticated = new Authenticated<T>(user, this.guard())

    return this.authenticated;
  }

  logout(): Promise<void> {
    throw new Error("Method not implemented.");
  }
}

/**
 * The implementation behind the `Auth` facade (D8 #115): every call builds a per-guard `Authenticate`, which
 * resolves the app container's `AuthManager` from the current request's container (A4 #151).
 */
export class AuthService {
  async attempt<T extends Model>(user: T) {
    return new Authenticate<T>().attempt(user);
  }

  user<T extends Model>() {
    const user = ContextApi.getUser<T>();
    if(!user) return null;
    // The guard that authenticated the request, so its token is signed for that guard (A6 #335)
    return new Authenticate<T>(authenticatedGuard()).setUser(user);
  }

  id<A>(): A {
    throw new Error("Method not implemented.");
  }

  isAuthenticated(): boolean {
    throw new Error("Method not implemented.");
  }

  check(): boolean {
    throw new Error("Method not implemented.");
  }

  login<T extends Model>(user: T) {
    // The guard that authenticated the request, so its token is signed for that guard (A6 #335)
    return new Authenticate<T>(authenticatedGuard()).login(user);
  }

  guard<T extends Model>(guardName: string) {
    const authenticated = new Authenticate<T>(guardName);
    const user = ContextApi.getUser<T>();
    if(user) authenticated.setUser(user);
    return authenticated;
  }

  logout(): Promise<void> {
    throw new Error("Method not implemented.");
  }
}

export default class Auth extends Facade {
  static override readonly accessor = AuthService;

  async attempt<T extends Model>(user: T) {
    return Auth.root().attempt(user);
  }

  static user<T extends Model>() {
    return Auth.root().user<T>();
  }

  static id<A>(): A {
    return Auth.root().id<A>();
  }

  static isAuthenticated(): boolean {
    return Auth.root().isAuthenticated();
  }

  static check(): boolean {
    return Auth.root().check();
  }

  static login<T extends Model>(user: T) {
    return Auth.root().login(user);
  }

  static guard<T extends Model>(guardName: string) {
    return Auth.root().guard<T>(guardName);
  }

  static logout(): Promise<void> {
    return Auth.root().logout();
  }

}
