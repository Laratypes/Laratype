// D8 #115: Hash is a facade over the container binding of Hasher
import { randomBytes, scryptSync } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
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

  it('refuses a stored scrypt cost above its memory bound instead of running it', () => {
    const [, , , salt, key] = hasher.make('secret').split('$')
    const costly = `$scrypt$N=1048576,r=8,p=1$${salt}$${key}`
    expect(hasher.check('secret', costly)).toBe(false)
    expect(hasher.isHashed(costly)).toBe(false)
    expect(hasher.check('secret', `$scrypt$N=1000,r=8,p=1$${salt}$${key}`)).toBe(false)
  })

  it('verifies a hash made with another scrypt cost, and asks for a rehash', () => {
    const salt = randomBytes(16)
    const key = scryptSync('secret', salt, 32, { N: 1024, r: 8, p: 1 })
    const other = `$scrypt$N=1024,r=8,p=1$${salt.toString('base64')}$${key.toString('base64')}`
    expect(hasher.check('secret', other)).toBe(true)
    expect(hasher.check('other', other)).toBe(false)
    expect(hasher.needsRehash(other)).toBe(true)
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
