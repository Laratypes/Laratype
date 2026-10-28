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

/** scrypt on the libuv thread pool, so a login does not block the event loop. */
const derive = (value: string, salt: Buffer, keyLength: number, options: crypto.ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(value, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });

const encode = (salt: Buffer, key: Buffer) => `${PREFIX}${salt.toString('base64')}$${key.toString('base64')}`;

/** A 0.5 sha256 hash, compared as `check()` does synchronously: computing it is cheap. */
const checkLegacy = (value: string, hashed: string) =>
  crypto.timingSafeEqual(crypto.createHash('sha256').update(value).digest(), Buffer.from(hashed, 'hex'));

/** The format `check()` can verify against: the scrypt parameters, the 0.5 sha256 marker, or undefined. */
const stored = (hashed: string) => parse(hashed) ?? (LEGACY_HASH.test(hashed) ? 'legacy' : undefined);

/** The implementation behind the `Hash` facade: salted scrypt, stored as `$scrypt$N=<n>,r=<r>,p=<p>$<salt>$<key>` (base64). */
export class Hasher {
  /** A new salted hash of `value`: two calls give two different strings. */
  public make(value: string): string {
    const salt = crypto.randomBytes(SALT_BYTES);
    const key = crypto.scryptSync(value, salt, KEY_BYTES, { ...COST, maxmem: MAX_MEMORY });
    return encode(salt, key);
  }

  /**
   * `make()` off the event loop. A custom Hasher that overrides `make()` keeps its own format: this resolves with
   * that method's result instead of running scrypt.
   */
  public async makeAsync(value: string): Promise<string> {
    if (this.make !== Hasher.prototype.make) return this.make(value);
    const salt = crypto.randomBytes(SALT_BYTES);
    return encode(salt, await derive(value, salt, KEY_BYTES, { ...COST, maxmem: MAX_MEMORY }));
  }

  /** Whether `value` matches `hashed`: a hash `make()` wrote, or a 0.5 sha256 hash, so stored passwords keep working. */
  public check(value: string, hashed: string): boolean {
    if (typeof value !== 'string' || typeof hashed !== 'string') return false;
    const format = stored(hashed);
    if (format === 'legacy') return checkLegacy(value, hashed);
    if (!format) return false;
    const { N, r, p, salt, key } = format;
    try {
      return crypto.timingSafeEqual(crypto.scryptSync(value, salt, key.length, { N, r, p, maxmem: MAX_MEMORY }), key);
    } catch {
      return false;
    }
  }

  /**
   * `check()` off the event loop: the login path awaits this one, so a request does not run scrypt itself. A custom
   * Hasher that overrides `check()` keeps its own format: this resolves with that method's result instead.
   */
  public async checkAsync(value: string, hashed: string): Promise<boolean> {
    if (this.check !== Hasher.prototype.check) return this.check(value, hashed);
    if (typeof value !== 'string' || typeof hashed !== 'string') return false;
    const format = stored(hashed);
    if (format === 'legacy') return checkLegacy(value, hashed);
    if (!format) return false;
    const { N, r, p, salt, key } = format;
    try {
      return crypto.timingSafeEqual(await derive(value, salt, key.length, { N, r, p, maxmem: MAX_MEMORY }), key);
    } catch {
      return false;
    }
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

  public static makeAsync(value: string): Promise<string> {
    return Hash.root().makeAsync(value);
  }

  public static check(value: string, hashed: string): boolean {
    return Hash.root().check(value, hashed);
  }

  public static checkAsync(value: string, hashed: string): Promise<boolean> {
    return Hash.root().checkAsync(value, hashed);
  }

  public static needsRehash(hashed: string): boolean {
    return Hash.root().needsRehash(hashed);
  }

  public static isHashed(value: string): boolean {
    return Hash.root().isHashed(value);
  }

}
