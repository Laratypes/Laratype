import crypto from 'crypto';
import { Facade } from '@laratype/core';

/** The implementation behind the `Hash` facade. */
export class Hasher {
  public make(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}

export default class Hash extends Facade {
  static override readonly accessor = Hasher;

  public static make(value: string): string {
    return Hash.root().make(value);
  }

}
