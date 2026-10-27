import type { Model } from "@laratype/database";
import type { LaratypeConfig as Config } from "@laratype/support";
import TokenGuard from "./TokenGuard";
import PassportGuard from "./PassportGuard";

/**
 * Builds the guards of `app/config/auth.ts` (A4 #151). A singleton in the app container, bound by
 * `PassportServiceProvider.register()`: resolve it with `container.make(AuthManager)`.
 * Moves onto the shared driver `Manager` when F1 #160 lands.
 */
export default class AuthManager {

  protected readonly guards = new Map<string, TokenGuard>();

  constructor(
    public readonly config: Config.Auth,
    /** The PersonalAccessToken model, when the app has one. */
    protected readonly tokenModel?: typeof Model,
  ) {}

  /** The name of the default guard, `default.guard` in `app/config/auth.ts`. */
  get defaultGuard(): string {
    return this.config.default.guard;
  }

  /**
   * The guard named `name` (the default guard when omitted), built once and cached: a `PassportGuard` when its
   * config has a `strategy`, else a `TokenGuard`.
   */
  guard<User = any>(name: string = this.defaultGuard): TokenGuard<User> {
    let guard = this.guards.get(name);
    if (!guard) {
      if (!Object.prototype.hasOwnProperty.call(this.config.guards, name)) {
        throw new Error(`[@laratype/auth] Auth guard "${name}" is not defined in app/config/auth.ts.`);
      }
      const config = this.config.guards[name];
      guard = config.strategy
        ? new PassportGuard(name, config, this.tokenModel)
        : new TokenGuard(name, config, this.tokenModel);
      this.guards.set(name, guard);
    }
    return guard;
  }
}
