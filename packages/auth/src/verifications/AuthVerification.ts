import type { Model } from "@laratype/database";
import type TokenGuard from "../guard/TokenGuard";
import type { JWTSignOptions } from "../guard/TokenGuard";
import { authManager } from "../guard/resolve";

export class Authenticated<T extends Model = any> {

  private user: T;
  protected guard: TokenGuard<T>;

  constructor(user: T, guard: TokenGuard<T>) {
    this.user = user;
    this.guard = guard;
  }

  async generateToken(options: JWTSignOptions) {
    return this.guard.issueToken(this.user, options);
  }

  getUser(): T {
    return this.user;
  }
}

export default class AuthVerification {

  /** The guard named `guardName`, from the app container's `AuthManager`. */
  public static guard(guardName: string) {
    return authManager().guard(guardName);
  }

  /** The user `token` belongs to, verified by the default guard, or `false`. */
  public static verify(token: string): Promise<any> {
    return authManager().guard().verify(token);
  }

}
