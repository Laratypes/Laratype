import { ContextApi } from "@laratype/support";
import type { Model } from "@laratype/database";
import { Authenticated } from "../verifications/AuthVerification";
import { authManager } from "../guard/resolve";

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

export default class Auth {
  async attempt<T extends Model>(user: T) {
    return new Authenticate<T>().attempt(user);
  }

  static user<T extends Model>() {
    const user = ContextApi.getUser<T>();
    if(!user) return null;
    return new Authenticate<T>().setUser(user);
  }

  static id<A>(): A {
    throw new Error("Method not implemented.");
  }

  static isAuthenticated(): boolean {
    throw new Error("Method not implemented.");
  }

  static check(): boolean {
    throw new Error("Method not implemented.");
  }

  static login<T extends Model>(user: T) {
    return new Authenticate<T>().login(user);
  }

  static guard<T extends Model>(guardName: string) {
    const authenticated = new Authenticate<T>(guardName);
    const user = ContextApi.getUser<T>();
    if(user) authenticated.setUser(user);
    return authenticated;
  }

  static logout(): Promise<void> {
    throw new Error("Method not implemented.");
  }

}
