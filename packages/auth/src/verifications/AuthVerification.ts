import type { Model } from "@laratype/database";
import type TokenGuard from "../guard/TokenGuard";
import type { JWTSignOptions } from "../guard/TokenGuard";
import { authManager } from "../guard/resolve";
import type { GuardName } from "../Register";
import { GateManager } from "../gate";
import type { CheckPolicy, SubjectAbility, SubjectArgs } from "../policies/Policy";

export class Authenticated<T extends Model = any> {

  private user: T;
  protected guard: TokenGuard<T>;

  constructor(user: T, guard: TokenGuard<T>) {
    this.user = user;
    this.guard = guard;
  }

  /**
   * Whether the signed-in user may run `ability` on `subject`, as the policy registered for the subject's model
   * decides (docs/v1/auth.md › Policies and gates). Not the 0.5 `@UsePolicy` mixin: this one reads the subject's
   * policy, as Laravel's `$user->can()` does.
   */
  can<M, K extends SubjectAbility<M>, A extends SubjectArgs<M, K> & unknown[]>(
    ability: K,
    subject: M & CheckPolicy<M>,
    ...args: A
  ): Promise<boolean> {
    return GateManager.current().allows(this.user, ability, subject, ...args);
  }

  /** The inverse of `can()`: `true` only when the user may not run the ability. */
  async cannot<M, K extends SubjectAbility<M>, A extends SubjectArgs<M, K> & unknown[]>(
    ability: K,
    subject: M & CheckPolicy<M>,
    ...args: A
  ): Promise<boolean> {
    return GateManager.current().denies(this.user, ability, subject, ...args);
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
  public static guard(guardName: GuardName) {
    return authManager().guard(guardName);
  }

  /** The user `token` belongs to, verified by the default guard, or `false`. */
  public static verify(token: string): Promise<any> {
    return authManager().guard().verify(token);
  }

}
