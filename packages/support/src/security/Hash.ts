import crypto from 'crypto';

export default class Hash {
  public static make(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

}