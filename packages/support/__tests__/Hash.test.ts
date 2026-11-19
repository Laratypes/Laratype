// D8 #115: Hash is a facade over the container binding of Hasher
import crypto from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Container, Facade } from '@laratype/core'
import { Hash, Hasher } from '@laratype/support'

/** sha256('secret') as 0.5 stored it. */
const SHA256_SECRET = '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b'
const SCRYPT = /^\$scrypt\$N=16384,r=8,p=1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/
/** Stored costs make() never wrote; the parser takes digits only, so NaN, Infinity and a negative cost never reach scrypt. */
const FOREIGN_COSTS = ['N=32768,r=8,p=1', 'N=8192,r=8,p=1', 'N=16384,r=16,p=1', 'N=16384,r=8,p=2', 'N=NaN,r=8,p=1', 'N=16384,r=8,p=Infinity', 'N=-1,r=8,p=1']

/** A Hasher whose make() is replaced, for the swap and fake tests. */
const replacing = (make: (value: string) => string) =>
  new (class extends Hasher {
    override make(value: string) {
      return make(value)
    }
  })()

/** A Hasher of another format, to prove the async pair delegates to the overridden sync pair. */
class Bcrypt extends Hasher {
  override make(value: string) {
    return `bcrypt:${value}`
  }
  override check(value: string, hashed: string) {
    return hashed === `bcrypt:${value}`
  }
}

describe('Hasher', () => {
  const hasher = new Hasher()

  it('makes a salted scrypt hash: two calls differ', () => {
    const first = hasher.make('secret')
    expect(first).toMatch(SCRYPT)
    expect(hasher.make('secret')).not.toBe(first)
  })

  it('checks a password against its hash', () => {
    const hashed = hasher.make('secret')
    expect(hasher.check('secret', hashed)).toBe(true)
    expect(hasher.check('Secret', hashed)).toBe(false)
    expect(hasher.check('', hashed)).toBe(false)
  })

  it('accepts a 0.5 sha256 hash, which needs a rehash', () => {
    expect(hasher.check('secret', SHA256_SECRET)).toBe(true)
    expect(hasher.check('other', SHA256_SECRET)).toBe(false)
    expect(hasher.needsRehash(SHA256_SECRET)).toBe(true)
    expect(hasher.needsRehash(hasher.make('secret'))).toBe(false)
  })

  it('rejects malformed hashes and non-strings', () => {
    expect(hasher.check('secret', 'secret')).toBe(false)
    expect(hasher.check('secret', '')).toBe(false)
    expect(hasher.check('secret', SHA256_SECRET.toUpperCase())).toBe(false)
    expect(hasher.check(undefined as any, SHA256_SECRET)).toBe(false)
    expect(hasher.check('secret', null as any)).toBe(false)
  })

  it('refuses a stored hash at another cost without running scrypt', () => {
    const [, , , salt, key] = hasher.make('secret').split('$')
    const spy = vi.spyOn(crypto, 'scryptSync')
    for (const cost of FOREIGN_COSTS) {
      const other = `$scrypt$${cost}$${salt}$${key}`
      expect(hasher.check('secret', other)).toBe(false)
      expect(hasher.isHashed(other)).toBe(false)
      expect(hasher.needsRehash(other)).toBe(true)
    }
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('refuses a salt or key shorter than make() writes, without running scrypt', () => {
    const [, , , salt, key] = hasher.make('secret').split('$')
    const shortSalt = Buffer.from(salt, 'base64').subarray(0, 8).toString('base64')
    const shortKey = Buffer.from(key, 'base64').subarray(0, 16).toString('base64')
    const spy = vi.spyOn(crypto, 'scryptSync')
    for (const [storedSalt, storedKey] of [[shortSalt, key], [salt, shortKey]]) {
      const other = `$scrypt$N=16384,r=8,p=1$${storedSalt}$${storedKey}`
      expect(hasher.check('secret', other)).toBe(false)
      expect(hasher.isHashed(other)).toBe(false)
      expect(hasher.needsRehash(other)).toBe(true)
    }
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('tells a scrypt hash from a plain value', () => {
    expect(hasher.isHashed(hasher.make('secret'))).toBe(true)
    expect(hasher.isHashed('secret')).toBe(false)
    expect(hasher.isHashed(SHA256_SECRET)).toBe(false)
  })
})

describe('Hasher async methods', () => {
  const hasher = new Hasher()

  it('makes a salted scrypt hash, as make() does', async () => {
    const first = await hasher.makeAsync('secret')
    expect(first).toMatch(SCRYPT)
    expect(await hasher.makeAsync('secret')).not.toBe(first)
  })

  it('accepts a hash from either method, both ways', async () => {
    const sync = hasher.make('secret')
    const asyncHash = await hasher.makeAsync('secret')
    expect(hasher.check('secret', asyncHash)).toBe(true)
    expect(await hasher.checkAsync('secret', sync)).toBe(true)
    expect(hasher.check('wrong', asyncHash)).toBe(false)
    expect(await hasher.checkAsync('wrong', sync)).toBe(false)
    // A makeAsync() hash is a current hash: Model stores it as is and the login does not rehash it
    expect(hasher.isHashed(asyncHash)).toBe(true)
    expect(hasher.needsRehash(asyncHash)).toBe(false)
  })

  it('accepts a 0.5 sha256 hash', async () => {
    expect(await hasher.checkAsync('secret', SHA256_SECRET)).toBe(true)
    expect(await hasher.checkAsync('other', SHA256_SECRET)).toBe(false)
  })

  it('answers a wrong password false and never throws', async () => {
    expect(await hasher.checkAsync('wrong', hasher.make('secret'))).toBe(false)
    // The malformed values the sync check refuses, as a login can read them from the database
    for (const malformed of ['secret', '', SHA256_SECRET.toUpperCase(), '$scrypt$N=16384,r=8,p=1$']) {
      expect(await hasher.checkAsync('secret', malformed)).toBe(false)
    }
    expect(await hasher.checkAsync(undefined as any, SHA256_SECRET)).toBe(false)
    expect(await hasher.checkAsync('secret', null as any)).toBe(false)
  })

  it('refuses a stored hash at another cost, or a shorter salt or key, without running scrypt', async () => {
    const [, , , salt, key] = hasher.make('secret').split('$')
    const shortSalt = Buffer.from(salt, 'base64').subarray(0, 8).toString('base64')
    const shortKey = Buffer.from(key, 'base64').subarray(0, 16).toString('base64')
    const spy = vi.spyOn(crypto, 'scrypt')
    for (const cost of FOREIGN_COSTS) {
      expect(await hasher.checkAsync('secret', `$scrypt$${cost}$${salt}$${key}`)).toBe(false)
    }
    expect(await hasher.checkAsync('secret', `$scrypt$N=16384,r=8,p=1$${shortSalt}$${key}`)).toBe(false)
    expect(await hasher.checkAsync('secret', `$scrypt$N=16384,r=8,p=1$${salt}$${shortKey}`)).toBe(false)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('derives with crypto.scrypt, not scryptSync', async () => {
    const hashed = hasher.make('secret')
    const asyncSpy = vi.spyOn(crypto, 'scrypt')
    const syncSpy = vi.spyOn(crypto, 'scryptSync')
    expect(await hasher.checkAsync('secret', hashed)).toBe(true)
    expect(await hasher.makeAsync('secret')).toMatch(SCRYPT)
    expect(asyncSpy).toHaveBeenCalledTimes(2)
    expect(syncSpy).not.toHaveBeenCalled()
    asyncSpy.mockRestore()
    syncSpy.mockRestore()
  })

  it('delegates to a custom Hasher that overrides make() and check(): its format keeps working', async () => {
    const custom = new Bcrypt()
    const hashed = await custom.makeAsync('secret')
    expect(hashed).toBe('bcrypt:secret')
    expect(await custom.checkAsync('secret', hashed)).toBe(true)
    expect(await custom.checkAsync('wrong', hashed)).toBe(false)
  })

  it('delegates to an overridden check()', async () => {
    class Refusing extends Hasher {
      override check() {
        return false
      }
    }
    expect(await new Refusing().checkAsync('secret', hasher.make('secret'))).toBe(false)
  })

  it('does not infer a check() from an overridden make(), so a custom format overrides both', async () => {
    class Upper extends Hasher {
      override make(value: string) {
        return value.toUpperCase()
      }
    }
    expect(await new Upper().makeAsync('secret')).toBe('SECRET')
    // The base checkAsync only understands the format the base make() writes
    expect(await new Upper().checkAsync('secret', 'SECRET')).toBe(false)
  })
})

describe('Hash facade', () => {
  afterEach(() => Facade.setFacadeApplication(undefined))

  it('hashes and checks with Hasher by default', () => {
    const hashed = Hash.make('secret')
    expect(hashed).toMatch(SCRYPT)
    expect(Hash.check('secret', hashed)).toBe(true)
    expect(Hash.needsRehash(hashed)).toBe(false)
    expect(Hash.isHashed(hashed)).toBe(true)
  })

  it('hashes and checks asynchronously with Hasher by default', async () => {
    const hashed = await Hash.makeAsync('secret')
    expect(hashed).toMatch(SCRYPT)
    expect(await Hash.checkAsync('secret', hashed)).toBe(true)
    expect(await Hash.checkAsync('wrong', hashed)).toBe(false)
  })

  it('resolves the async methods on a custom Hasher bound in the facade application', async () => {
    Facade.setFacadeApplication(new Container().bind(Hasher, Bcrypt))
    const hashed = await Hash.makeAsync('secret')
    expect(hashed).toBe('bcrypt:secret')
    expect(await Hash.checkAsync('secret', hashed)).toBe(true)
  })

  it('works detached from the class, as in 0.5', () => {
    const [hashed] = ['secret'].map(Hash.make)
    expect(['secret'].map((value) => Hash.check(value, hashed!))).toEqual([true])
  })

  it('resolves the Hasher bound in the facade application', () => {
    class Upper extends Hasher {
      override make(value: string) {
        return value.toUpperCase()
      }
    }
    Facade.setFacadeApplication(new Container().bind(Hasher, Upper))
    expect(Hash.make('secret')).toBe('SECRET')
  })

  it('app.swap() replaces the implementation', () => {
    const app = new Container()
    Facade.setFacadeApplication(app)
    const restore = app.swap(Hasher, replacing((value) => `swapped:${value}`))
    expect(Hash.make('secret')).toBe('swapped:secret')
    restore()
    expect(Hash.make('secret')).toMatch(SCRYPT)
  })

  it('Hash.fake() replaces the implementation', () => {
    const restore = Hash.fake(replacing((value) => `fake:${value}`))
    expect(Hash.make('secret')).toBe('fake:secret')
    restore()
    expect(Hash.make('secret')).toMatch(SCRYPT)
  })
})
