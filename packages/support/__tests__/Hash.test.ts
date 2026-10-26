// D8 #115: Hash is a facade over the container binding of Hasher
import { afterEach, describe, expect, it } from 'vitest'
import { Container, Facade } from '@laratype/core'
import { Hash, Hasher } from '@laratype/support'

const SHA256_SECRET = '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b'

describe('Hash facade', () => {
  afterEach(() => Facade.setFacadeApplication(undefined))

  it('hashes with Hasher (sha256) by default, as in 0.5', () => {
    expect(Hash.make('secret')).toBe(SHA256_SECRET)
    expect(new Hasher().make('secret')).toBe(SHA256_SECRET)
  })

  it('works detached from the class, as in 0.5', () => {
    expect(['secret'].map(Hash.make)).toEqual([SHA256_SECRET])
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
    const restore = app.swap(Hasher, { make: value => `swapped:${value}` })
    expect(Hash.make('secret')).toBe('swapped:secret')
    restore()
    expect(Hash.make('secret')).toBe(SHA256_SECRET)
  })

  it('Hash.fake() replaces the implementation', () => {
    const restore = Hash.fake({ make: value => `fake:${value}` })
    expect(Hash.make('secret')).toBe('fake:secret')
    restore()
    expect(Hash.make('secret')).toBe(SHA256_SECRET)
  })
})
