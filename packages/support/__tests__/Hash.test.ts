// D8 #115: Hash is a facade over the container binding of Hasher
import crypto from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Container, Facade } from '@laratype/core'
import { Hash, Hasher } from '@laratype/support'

/** sha256('secret') as 0.5 stored it. */
const SHA256_SECRET = '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b'
const SCRYPT = /^\$scrypt\$N=16384,r=8,p=1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/

/** A Hasher whose make() is replaced, for the swap and fake tests. */
const replacing = (make: (value: string) => string) =>
  new (class extends Hasher {
    override make(value: string) {
      return make(value)
    }
  })()

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
    for (const cost of ['N=32768,r=8,p=1', 'N=8192,r=8,p=1', 'N=16384,r=16,p=1', 'N=16384,r=8,p=2']) {
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

describe('Hash facade', () => {
  afterEach(() => Facade.setFacadeApplication(undefined))

  it('hashes and checks with Hasher by default', () => {
    const hashed = Hash.make('secret')
    expect(hashed).toMatch(SCRYPT)
    expect(Hash.check('secret', hashed)).toBe(true)
    expect(Hash.needsRehash(hashed)).toBe(false)
    expect(Hash.isHashed(hashed)).toBe(true)
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
