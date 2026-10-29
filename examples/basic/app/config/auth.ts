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
       * credentials (E5 #343). In production the strategy stays: a missing clientID then fails the boot loudly.
       */
      get strategy() {
        return googleConfigured() || isProduction() ? PassportStrategy.make(GoogleStrategy) as typeof Strategy : undefined;
      },
      provider: User,
      options: {
        clientID: Env.get('AUTH_GOOGLE_CLIENT_ID', ''),
        clientSecret: Env.get('AUTH_GOOGLE_CLIENT_SECRET', ''),
        callbackURL: '/api/passport/google/callback',
        scope: ['profile', 'email'],
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
