import { PassportStrategy, type Strategy } from "@laratype/auth";
import { type LaratypeConfig as Config, Env } from "@laratype/support";
import GoogleStrategy from 'passport-google-oidc';
import LocalStrategy from 'passport-local';
import User from "../src/models/User";
import Admin from "../src/models/Admin";

// `sauf build`'s entry sets `__PROD__`; a bare NODE_ENV=production counts too, as the contract response check does.
const isProduction = () => Boolean(globalThis.__PROD__ ?? globalThis.process?.env?.NODE_ENV === "production");

/** Whether passport-google-oidc can build its strategy: it throws when the clientID is empty. */
const googleConfigured = () => Boolean(Env.get('AUTH_GOOGLE_CLIENT_ID', '') && Env.get('AUTH_GOOGLE_CLIENT_SECRET', ''));

/** A production boot must not silently run without the Google guard it declares (E5 #343). */
const requireGoogleInProduction = () => {
  if (isProduction() && !googleConfigured()) {
    throw new Error("examples/basic: AUTH_GOOGLE_CLIENT_ID and AUTH_GOOGLE_CLIENT_SECRET are required in production: the Google guard cannot register without them.");
  }
};

export default {

  default: {
    guard: Env.get('AUTH_GUARD', 'web')
  },
  
  guards: {
    web: {
      strategyName: 'local',
      strategy: PassportStrategy.make(LocalStrategy) as typeof Strategy,
      options: {
        usernameField: 'email',
        passwordField: 'password',
      },
      provider: User,
      verification: 'jwt',
    },
    api: {
      strategyName: 'google',
      /**
       * Without credentials the guard is a TokenGuard (no strategy), so a boot outside production does not need Google
       * credentials (E5 #343). In production a missing credential throws from the getter, failing the boot loudly.
       */
      get strategy() {
        requireGoogleInProduction();
        return googleConfigured() ? PassportStrategy.make(GoogleStrategy) as typeof Strategy : undefined;
      },
      provider: User,
      // Read with the strategy: the config module is evaluated once, but a boot may see different credentials
      get options() {
        return {
          clientID: Env.get('AUTH_GOOGLE_CLIENT_ID', ''),
          clientSecret: Env.get('AUTH_GOOGLE_CLIENT_SECRET', ''),
          callbackURL: '/api/passport/google/callback',
          scope: ['profile', 'email'],
        };
      },
      verification: 'jwt',
    },
    admin: {
      strategyName: 'local',
      strategy: PassportStrategy.make(LocalStrategy) as typeof Strategy,
      options: {
        usernameField: 'email',
        passwordField: 'password',
      },
      provider: Admin,
      verification: 'jwt',
    }
  },

} satisfies Config.Auth
