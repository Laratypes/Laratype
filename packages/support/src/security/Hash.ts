import crypto from 'crypto';
import { Facade } from '@laratype/core';

/** scrypt cost of new hashes (16 MiB per hash). */
const COST = { N: 16384, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
/** scrypt's memory cap for `make()` and `check()` (128 * N * r bytes). */
const MAX_MEMORY = 256 * 1024 * 1024;

const PREFIX = `$scrypt$N=${COST.N},r=${COST.r},p=${COST.p}$`;
const SCRYPT_HASH = /^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;
/** The 0.5 format: an unsalted sha256, hex. */
const LEGACY_HASH = /^[0-9a-f]{64}$/;

const parse = (hashed: string) => {
  const match = SCRYPT_HASH.exec(hashed);
  if (!match) return undefined;
  const [N, r, p] = match.slice(1, 4).map(Number) as [number, number, number];
  // make() has only ever written this cost and these lengths; anything else is not a stored hash it produced
  if (N !== COST.N || r !== COST.r || p !== COST.p) return undefined;
  const salt = Buffer.from(match[4]!, 'base64');
  const key = Buffer.from(match[5]!, 'base64');
  if (salt.length !== SALT_BYTES || key.length !== KEY_BYTES) return undefined;
  return { N, r, p, salt, key };
};

/** The implementation behind the `Hash` facade: salted scrypt, stored as `$scrypt$N=<n>,r=<r>,p=<p>$<salt>$<key>` (base64). */
export class Hasher {
  /** A new salted hash of `value`: two calls give two different strings. */
  public make(value: string): string {
    const salt = crypto.randomBytes(SALT_BYTES);
    const key = crypto.scryptSync(value, salt, KEY_BYTES, { ...COST, maxmem: MAX_MEMORY });
    return `${PREFIX}${salt.toString('base64')}$${key.toString('base64')}`;
  }

  /** Whether `value` matches `hashed`: a hash `make()` wrote, or a 0.5 sha256 hash, so stored passwords keep working. */
  public check(value: string, hashed: string): boolean {
    if (typeof value !== 'string' || typeof hashed !== 'string') return false;
    const scrypt = parse(hashed);
    if (scrypt) {
      const { N, r, p, salt, key } = scrypt;
      try {
        return crypto.timingSafeEqual(crypto.scryptSync(value, salt, key.length, { N, r, p, maxmem: MAX_MEMORY }), key);
      } catch {
        return false;
      }
    }
    if (LEGACY_HASH.test(hashed)) {
      return crypto.timingSafeEqual(crypto.createHash('sha256').update(value).digest(), Buffer.from(hashed, 'hex'));
    }
    return false;
  }

  /** Whether `hashed` is not what `make()` gives today (a 0.5 sha256 hash, or a hash at another cost), so it should be replaced. */
  public needsRehash(hashed: string): boolean {
    return typeof hashed !== 'string' || parse(hashed) === undefined;
  }

  /** Whether `value` is already a hash `make()` wrote, which is stored as it is instead of being hashed again. */
  public isHashed(value: string): boolean {
    return typeof value === 'string' && parse(value) !== undefined;
  }
}

export default class Hash extends Facade {
  static override readonly accessor = Hasher;

  public static make(value: string): string {
    return Hash.root().make(value);
  }

  public static check(value: string, hashed: string): boolean {
    return Hash.root().check(value, hashed);
  }

  public static needsRehash(hashed: string): boolean {
    return Hash.root().needsRehash(hashed);
  }

  public static isHashed(value: string): boolean {
    return Hash.root().isHashed(value);
  }

}
