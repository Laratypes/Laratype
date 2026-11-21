import jsonwebtoken from 'jsonwebtoken';
import { Config } from '@laratype/support';
import type { JWTSignOptions } from '../guard/TokenGuard';

/**
 * The JWT format of a token guard's tokens (A6 #335): HS256 only, so a token signed with another algorithm, even with
 * the same secret, never verifies. The `guard` claim is checked by `TokenGuard`, which knows its name.
 */
export default class JWTVerification {

  public static async sign(payload: any, options: JWTSignOptions): Promise<string> {
    const token = jsonwebtoken.sign(payload, Config.get(['key']), {
      algorithm: 'HS256',
      expiresIn: options.expiresIn,
    });
    return token;
  }

  public static async verify(token: string) {
    return jsonwebtoken.verify(token, Config.get(['key']), {
      algorithms: ['HS256'],
    });
  }

}
