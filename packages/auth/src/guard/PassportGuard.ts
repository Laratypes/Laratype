import type { PassportStatic } from "passport";
import TokenGuard from "./TokenGuard";

type VerifyCallback = (err: any, user: any, info?: any) => void;

/**
 * A token guard that logs users in through its passport strategy (A4 #151). `PassportServiceProvider.boot()`
 * registers the strategy under the guard's name, so `Passport.authenticate('<guard>')` runs it; the tokens it
 * issues are verified like any `TokenGuard`'s.
 */
export default class PassportGuard<User = any> extends TokenGuard<User> {

  /** Registers the guard's strategy with `passport` under the guard's name. */
  register(passport: PassportStatic, store: unknown) {
    const { usernameField, passwordField } = this.config.options ?? {};
    // The local verify callback looks the user up by exactly these keys: without them it would query `undefined`
    if (this.config.strategyName === 'local' && (typeof usernameField !== 'string' || typeof passwordField !== 'string')) {
      throw new Error(`[@laratype/auth] Auth guard "${this.name}": a local strategy needs options.usernameField and options.passwordField.`);
    }
    const Strategy = this.config.strategy as any;
    passport.use(this.name, new Strategy({
      ...this.config.options,
      store,
    }, (issuer: any, profile: any, cb: VerifyCallback) => {
      if (this.config.strategyName !== 'local') {
        // Handle other strategies
        cb(null, false, { message: 'Strategy not implemented' });
        return;
      }

      this.verifyLocal(issuer, profile, cb);
    }));
  }

  protected verifyLocal(username: string, password: string, cb: VerifyCallback) {
    const options = this.config.options ?? {};
    this.attempt({
      [options.usernameField]: username,
      [options.passwordField]: password,
    }).then((user) => {
      if (user) {
        cb(null, user);
        return;
      }
      cb(null, false, { message: 'Incorrect username or password.' });
    }, (err) => cb(err, false));
  }
}
