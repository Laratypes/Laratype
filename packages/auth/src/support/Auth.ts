import { ContextApi } from "@laratype/support";
import { Model } from "@laratype/database";
import { Authenticated } from "../verifications/AuthVerification";
import Authentication from "../passport/Authentication";
import { GuardStore } from "../passport/PassportServiceProvider";

class Authenticate<T extends Model> {
  
  protected guardName: string;
  protected authenticated?: Authenticated<T>;

  constructor(guardName: string) {
    this.guardName = guardName;
  }

  async attempt(fields: Record<string, any>) {
    const guards = GuardStore.getGuards();
    const guard = guards[this.guardName];

    const user = await Authentication.login(guard, fields)

    if(!user) {
      return false;
    }

    this.authenticated = new Authenticated<T>(user, guard, this.guardName)

    return this.authenticated;
  }

  setUser(user: T) {
    const guards = GuardStore.getGuards();
    const guard = guards[this.guardName];
    this.authenticated = new Authenticated<T>(user, guard, this.guardName)

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
    const guards = GuardStore.getGuards();
    const guard = guards[this.guardName];

    this.authenticated = new Authenticated<T>(user, guard, this.guardName)

    return this.authenticated;
  }

  logout(): Promise<void> {
    throw new Error("Method not implemented.");
  }
}

export default class Auth {
  async attempt<T extends Model>(user: T) {
    const auth = GuardStore.getAuthConfig();
    return new Authenticate<T>(auth.default.guard).attempt(user);
  }

  static user<T extends Model>() {
    const user = ContextApi.getUser<T>();
    if(!user) return null;
    const auth = GuardStore.getAuthConfig();
    return new Authenticate<T>(auth.default.guard).setUser(user);
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
    const auth = GuardStore.getAuthConfig();
    return new Authenticate<T>(auth.default.guard).login(user);
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
