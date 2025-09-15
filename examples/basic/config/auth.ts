import { PassportStrategy, Strategy } from "@laratype/auth";
import { LaratypeConfig as Config, Env } from "@laratype/support";
import GoogleStrategy from 'passport-google-oidc';
import LocalStrategy from 'passport-local';
import { User } from "../src/models/User";

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
    },
    api: {
      strategyName: 'google',
      strategy: PassportStrategy.make(GoogleStrategy) as typeof Strategy,
      provider: User,
      options: {
        clientID: Env.get('AUTH_GOOGLE_CLIENT_ID', ''),
        clientSecret: Env.get('AUTH_GOOGLE_CLIENT_SECRET', ''),
        callbackURL: '/api/passport/google/callback',
        scope: ['profile', 'email'],
      },
    }
  },

} satisfies Config.Auth