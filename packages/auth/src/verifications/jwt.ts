import jsonwebtoken from 'jsonwebtoken';
import { Config } from '@laratype/support';
import { JWTSignOptions } from './AuthVerification';

export default class JWTVerification {

  public static async sign(payload: any, options: JWTSignOptions): Promise<string> {
    const token = jsonwebtoken.sign(payload, Config.get(['key']), {
      expiresIn: options.expiresIn,
    });
    return token;
  }

  public static async verify(token: string) {
    return jsonwebtoken.verify(token, Config.get(['key']));
  }

}
